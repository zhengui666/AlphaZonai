import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {Harness,createRegistry,defineExtension} from '@earendil-works/pi-durable';
import {openNodeSqliteStorage} from '@earendil-works/pi-durable/storage/sqlite/node';
import {createModels} from '@earendil-works/pi-ai/models';
import {createDailySchedule,DailyScheduleState,ensureDailySchedule} from '../src/daily-review.ts';
import {importPerformance,performanceReport,PerformanceReport} from '../src/performance.ts';
import {reviewContext} from '../src/review-analysis.ts';
import {Reviews} from '../src/review.ts';

test('daily schedule recovers missed days and retries late data and model setup once per mode',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'az-daily-'));
  const due=Date.parse('2026-11-27T00:00:00Z'),halfHour=1_800_000;
  let now=due-60_000,ready=false,modelChecks=0;
  const task=createDailySchedule({
    modelSettings:async()=>{modelChecks++;return ready?{provider:'openai',model:'test',speed:null,thinking:'off'}:null;},
    startReview:async(tx,input,mode)=>{(await tx.doc(Reviews)).reviews[input.id]={...input,mode};},
  });
  const start=async()=>{
    const registry=createRegistry();registry.install(defineExtension({name:'daily-test',tasks:[task]}));
    const h=await Harness.open(await openNodeSqliteStorage(join(dir,'pi.sqlite')),{models:createModels(),registry,now:()=>now},ctx);
    await (await h.root(ctx)).commit(tx=>ensureDailySchedule(tx,task,now),ctx);
    h.resume();return h;
  };
  let h=await start();
  async function advance(ms:number){await h.close(ctx);now=ms;h=await start();}
  async function finished(nextCheck:number){
    for(let i=0;i<300;i++){
      const state=await h.snapshot(DailyScheduleState,ctx);
      if(state?.nextCheckAt===new Date(nextCheck).toISOString())return state;
      await delay(5);
    }
    assert.fail(JSON.stringify(await h.snapshot(DailyScheduleState,ctx)));
  }
  const empty={id:randomUUID(),sessionId:randomUUID(),mode:'live',accountId:'ACCT-1',strategyId:'S-1',
    coverageStart:'2026-11-25T16:00:00Z',asOf:'2026-11-26T16:05:00Z',currencies:[],balances:[],positions:[],fills:[]};
  try{
    const initial=await finished(due);
    assert.equal(initial.lastDate,null);
    await (await h.root(ctx)).commit(tx=>importPerformance(tx,performanceReport(empty)),ctx);
    await advance(due);
    const first=await finished(due+halfHour);
    assert.equal(first.lastDate,'2026-11-26');
    assert.deepEqual(first.modes,{live:{status:'no_activity'},paper:{status:'no_data'}});
    assert.equal(modelChecks,0);
    const early=performanceReport({...empty,id:randomUUID(),mode:'paper',asOf:'2026-11-25T16:05:00Z',
      coverageStart:'2026-11-24T16:00:00Z',parameters:{entryThreshold:3}});
    const closing=performanceReport({...empty,id:randomUUID(),mode:'paper',parameters:{entryThreshold:9}});
    const paper=performanceReport({...empty,id:randomUUID(),mode:'paper',asOf:'2026-11-26T15:59:59.999999999Z',fills:[{
      time:'2026-11-26T15:59:59.999999999Z',tradeId:'T1',orderId:'O1',positionId:null,instrument:'A.SIM',
      side:'BUY',quantity:'1',price:'2',currency:'USD',commission:null,liquidity:'MAKER',
    }]});
    for(const report of [early,paper,closing])await (await h.root(ctx)).commit(tx=>importPerformance(tx,report),ctx);
    await advance(due+halfHour);
    assert.equal((await finished(due+2*halfHour)).modes.paper?.status,'model_unavailable');
    ready=true;
    await advance(due+2*halfHour);
    const submitted=await finished(due+3*halfHour);
    assert.equal(submitted.modes.paper?.status,'queued');
    const id=submitted.modes.paper!.reviewId!;
    const review=(await h.snapshot(Reviews,ctx))!.reviews[id];
    assert.deepEqual(new Set(review.reportIds),new Set([early.id,paper.id,closing.id]));
    assert.deepEqual(review.period,{date:'2026-11-26',start:'2026-11-25T16:00:00.000Z',end:'2026-11-26T16:00:00.000Z'});
    const reports=await Promise.all(review.reportIds.map((key:string)=>h.snapshot(PerformanceReport,key,ctx)));
    const context=reviewContext(reports,review.objective,review.language,review.period);
    assert.equal(context.reports[0].parameters[0].value,3);
    assert.equal(context.reports[0].parameters[0].ref,early.id+'/parameter/entryThreshold');
    await advance(due+3*halfHour);
    assert.equal((await finished(due+4*halfHour)).modes.paper?.reviewId,id);
    const afterOutage=due+96*halfHour;
    await advance(afterOutage);
    const caughtUp=await finished(afterOutage+halfHour);
    assert.equal(caughtUp.lastDate,'2026-11-28');
    assert.equal(caughtUp.task,initial.task);
    assert.deepEqual(Object.keys((await h.snapshot(Reviews,ctx))!.reviews),[id]);
    assert.equal(modelChecks,2);
  }finally{await h.close(ctx);await rm(dir,{recursive:true,force:true});}
});
