import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {Harness,createRegistry} from '@earendil-works/pi-durable';
import {openNodeSqliteStorage} from '@earendil-works/pi-durable/storage/sqlite/node';
import {createModels} from '@earendil-works/pi-ai/models';
import {createCogAlpha} from '../src/extension.ts';
import {importPerformance,performanceReport} from '../src/performance.ts';
import {ReviewInputs,Reviews,reviewRequest,sameReviewRequest} from '../src/review.ts';

test('retrying a review preserves its primary report, question and language',()=>{
  const ids=[randomUUID(),randomUUID()];
  const raw={id:randomUUID(),reportIds:ids};
  const request=reviewRequest(raw);
  assert.ok(sameReviewRequest(request,reviewRequest({...raw,objective:'  ',language:'zh-CN'})));
  assert.ok(!sameReviewRequest(request,reviewRequest({...raw,reportIds:[...ids].reverse()})));
  assert.ok(!sameReviewRequest(request,reviewRequest({...raw,objective:'Compare fills'})));
  assert.ok(!sameReviewRequest(request,reviewRequest({...raw,language:'en'})));
  const saved=reviewRequest(raw,{language:'en',objective:'Trading costs'});
  assert.deepEqual(saved,{...raw,language:'en',objective:'Trading costs'});
  assert.ok(sameReviewRequest(request,reviewRequest({...raw,language:'zh-CN',objective:''},saved)));
  assert.throws(()=>reviewRequest({...raw,reportIds:[ids[0],ids[0]]}),/BAD_REQUEST/);
});

test('review resumes its decision from the persisted diagnosis after restart',{timeout:10000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'az-review-'));
  const id=randomUUID(),report=performanceReport({
    id:randomUUID(),sessionId:randomUUID(),mode:'live',accountId:'CASH-1',strategyId:'TREND-001',
    asOf:'2026-11-27T01:00:00Z',currencies:[],balances:[],fills:[],positions:[],
  });
  const period={date:'2026-11-26',start:'2026-11-25T16:00:00Z',end:'2026-11-26T16:00:00Z'};
  const refs=[report.id],uncertainty='No closed positions in the supplied history.';
  const diagnosis={findings:[{observation:'The report contains zero positions.',refs,uncertainty}]};
  const decision={action:'insufficient',reason:'A closed sample is missing.',refs,uncertainty,nextStep:'Inspect the next closed position.'};
  const decisions={strategy:decision,portfolio:decision,parameters:decision};
  const firstDecision=Promise.withResolvers<void>();
  const calls:string[]=[];
  let rejectDecision=false;
  const workers={stateDir:dir,nautilusSettings:async()=>({python:'python3',targets:[]})};
  const {PerformanceReview,extension}=createCogAlpha(workers,undefined,async(api,_ctx,key,prompt)=>{
    calls.push(key);
    if(key==='review:diagnosis')return JSON.stringify(diagnosis);
    assert.ok(prompt.includes(diagnosis.findings[0].observation));
    if(calls.length===2){
      firstDecision.resolve();
      await delay(60000,undefined,{signal:api.signal});
    }
    return rejectDecision?'{}':JSON.stringify(decisions);
  });
  const open=async()=>{
    const registry=createRegistry();registry.install(extension);
    return Harness.open(await openNodeSqliteStorage(join(dir,'review.sqlite')),{models:createModels(),registry},ctx);
  };
  let h=await open();
  try{
    const root=await h.root(ctx);
    const task=await root.commit(async tx=>{
      await importPerformance(tx,report);
      (await tx.doc(Reviews)).reviews[id]={id,status:'diagnosing'};
      return tx.createTask(PerformanceReview,{id,reportIds:refs,objective:'Review trading costs.',language:'en',period},{ownership:{kind:'conversation'}});
    },ctx);
    h.resume();
    await firstDecision.promise;
    const partial=(await h.snapshot(Reviews,ctx))!.reviews[id];
    assert.equal(partial.status,'deciding');
    assert.deepEqual(partial.diagnosis,diagnosis);
    const inputs=(await h.snapshot(ReviewInputs,id,ctx))!;
    assert.equal(inputs.language,'en');
    assert.deepEqual(inputs.period,period);
    assert.equal(inputs.reports[0].ref,report.id);
    await h.close(ctx);
    h=await open();h.resume();
    await h.waitForTask(task,ctx);
    const final=(await h.snapshot(Reviews,ctx))!.reviews[id];
    assert.equal(final.status,'completed');
    assert.deepEqual(final.decisions,decisions);
    assert.deepEqual(await h.snapshot(ReviewInputs,id,ctx),inputs);
    assert.deepEqual(calls,['review:diagnosis','review:decision','review:decision']);

    rejectDecision=true;
    const retry=randomUUID();
    const failedTask=await (await h.root(ctx)).commit(async tx=>{
      (await tx.doc(Reviews)).reviews[retry]={id:retry,status:'diagnosing'};
      return tx.createTask(PerformanceReview,{id:retry,reportIds:refs,objective:'',language:'en'},{ownership:{kind:'conversation'}});
    },ctx);
    assert.equal((await h.waitForTask(failedTask,ctx)).state.outcome.status,'failed');
    const failed=(await h.snapshot(Reviews,ctx))!.reviews[retry];
    assert.equal(failed.error,'MODEL_FORMAT');
    assert.deepEqual(failed.diagnosis,diagnosis);
    assert.equal(failed.decisions,undefined);
  }finally{await h.close(ctx);await rm(dir,{recursive:true,force:true});}
});
