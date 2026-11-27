import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Report} from '../src/performance.ts';
import {decisionPrompt,diagnosisPrompt,hasDailyActivity,reviewContext,validateDecisions,validateDiagnosis} from '../src/review-analysis.ts';

const time=(day:number)=>new Date(Date.UTC(2026,10,day)).toISOString();
function report(account:string,days:number[],outcomes:string[]):Report {
  return {
    id:account==='A'?'00000000-0000-4000-8000-000000000001':'00000000-0000-4000-8000-000000000002',
    sessionId:'00000000-0000-4000-8000-000000000003',accountId:account,strategyId:'Trend-'+account,
    mode:'paper',asOf:time(days.at(-1)!),parameters:{'止损/bps':25},currencies:[],balances:[],
    positions:days.map((day,i)=>({id:'position-'+day,instrument:'BTC-PERP',side:'LONG',opened:time(day),closed:time(day),
      quantity:'0',peakQuantity:'1',realizedPnl:outcomes[i],tradeIds:['trade-'+day]})),
    fills:days.map(day=>({time:time(day),tradeId:'trade-'+day,orderId:'order-'+day,positionId:'position-'+day,
      instrument:'BTC-PERP',side:'SELL',quantity:'1',price:'100',currency:'USD',commission:'0.25 USD',liquidity:'TAKER'})),
  };
}

test('compares each account in the same observed interval and preserves the fee currency',()=>{
  const first=report('A',[1,2,3,4],['-90 USD','-4 USD','15 EUR','2 USD']);
  const second=report('B',[2,4,5],['12 USD','8 USD','-100 USD']);
  first.fills[0].commission='-0.01 ETH';
  const context=reviewContext([first,second],'检查交易成本');
  assert.equal(context.language,'zh-CN');
  assert.equal(Date.parse(context.commonWindow!.start),Date.parse(time(2)));
  assert.equal(Date.parse(context.commonWindow!.end),Date.parse(time(4)));
  const [a,b]=context.reports;
  const usd=a.window.find(row=>row.currency==='USD')!;
  assert.equal(usd.closedCount,2);
  assert.equal(Number(usd.worstPnl),-4);
  assert.equal(a.window.find(row=>row.currency==='EUR')!.closedCount,1);
  assert.equal(Number(b.window.find(row=>row.currency==='USD')!.worstPnl),8);
  assert.equal(a.fees.find(row=>row.currency==='USD')!.count,3);
  assert.equal(Number(a.fees.find(row=>row.currency==='ETH')!.maximum),-.01);
  assert.equal(a.parameters[0].ref,first.id+'/parameter/'+encodeURIComponent('止损/bps'));
  assert.match(diagnosisPrompt(context),/检查交易成本/);
  assert.equal(reviewContext([first,report('B',[8],['1 USD'])],'').commonWindow,null);
});

test('requires grounded observations and a complete, actionable decision in each of the three areas',()=>{
  const source=report('A',[3],['-2 USD']);
  const context=reviewContext([source],'','en');
  const refs=[context.reports[0].parameters[0].ref];
  const finding={observation:'One reported close',refs:[source.id],uncertainty:'One observation'};
  const diagnosis=validateDiagnosis({findings:[finding]},context);
  assert.match(decisionPrompt(context,diagnosis),/One reported close/);
  const change={action:'adjust',refs,reason:'Test the reported stop',uncertainty:'One outcome',nextStep:'Compare an adjacent setting on held-out data'};
  const decisions={strategy:{...change,action:'keep'},portfolio:{...change,action:'insufficient'},parameters:change};
  assert.deepEqual(validateDecisions(decisions,context),decisions);
  assert.throws(()=>validateDiagnosis({findings:[{...finding,refs:[source.id+'/fill/missing']}]},context),/MODEL_FORMAT/);
  assert.throws(()=>validateDecisions({...decisions,parameters:{...change,refs:[refs[0],refs[0]]}},context),/MODEL_FORMAT/);
  assert.throws(()=>validateDecisions({...decisions,parameters:{...change,action:'deploy'}},context),/MODEL_FORMAT/);
  assert.throws(()=>validateDecisions({...decisions,portfolio:undefined},context),/MODEL_FORMAT/);
});

test('keeps overlapping captures and modes separate, samples native fills, and exposes empty coverage',()=>{
  const paper=report('A',[2,3],['2 USD','-5 USD']);
  paper.fills=Array.from({length:160},(_,i)=>({...paper.fills[1],tradeId:'成交/'+i,commission:i+' USD'}));
  const live={...paper,id:'00000000-0000-4000-8000-000000000004',mode:'live' as const,fills:paper.fills.slice(0,3)};
  const repeat={...paper,id:'00000000-0000-4000-8000-000000000005'};
  const empty={...paper,id:'00000000-0000-4000-8000-000000000006',positions:[],fills:[]};
  const context=reviewContext([paper,repeat,live,empty],'');
  assert.equal(context.commonWindow,null);
  assert.deepEqual(context.reports.map(row=>[row.ref,row.mode,row.fillCount]),[
    [paper.id,'paper',160],[repeat.id,'paper',160],[live.id,'live',3],[empty.id,'paper',0],
  ]);
  assert.equal(context.reports[3].observed,null);
  const sample=context.reports[0];
  assert.equal(sample.fees[0].count,160);
  assert.ok(sample.fills.length<10);
  const largest=sample.fills.find(fill=>fill.commission==='159 USD')!;
  assert.equal(largest.tradeId,'成交/159');
  assert.equal(largest.ref,[paper.id,'fill','BTC-PERP','order-3',encodeURIComponent(largest.tradeId)].join('/'));
  assert.doesNotThrow(()=>validateDiagnosis({findings:[{observation:'Largest fee',refs:[largest.ref],uncertainty:'No benchmark'}]},context));
});

test('shows execution mix on a common instrument and retains each strategy’s open direction',()=>{
  const a=report('A',[1,2,3,4],['1 USD','2 USD','3 USD','4 USD']);
  const b=report('B',[2,3,5],['-1 USD','-2 USD','-3 USD']);
  const instrument='BTC/USD.PERP';
  for(const r of [a,b]){
    for(const fill of r.fills)fill.instrument=instrument;
    for(const p of r.positions)p.instrument=instrument;
    Object.assign(r.positions.at(-1)!,{closed:null,quantity:'1',side:r===a?'LONG':'SHORT'});
  }
  a.fills[0].liquidity='MAKER';a.fills[1].liquidity='NO_LIQUIDITY_SIDE';a.fills[2].liquidity='MAKER';
  const context=reviewContext([a,b],'');
  const [long,short]=context.reports.map(r=>r.instruments.find(x=>x.instrument===instrument)!);
  assert.deepEqual([long.fillCount,long.makerFills,long.takerFills],[4,2,1]);
  assert.deepEqual(long.window,{fillCount:3,makerFills:1,takerFills:1});
  assert.deepEqual(short.window,{fillCount:2,makerFills:0,takerFills:2});
  assert.deepEqual([long.openLong,long.openShort,short.openLong,short.openShort],[1,0,0,1]);
  assert.equal(long.ref,a.id+'/instrument/'+encodeURIComponent(instrument));
  assert.doesNotThrow(()=>validateDiagnosis({findings:[{observation:'Opposite open directions',refs:[long.ref,short.ref],uncertainty:'No weights supplied'}]},context));
});

test('daily review deduplicates overlapping snapshots at Shanghai midnight and keeps the native source',()=>{
  const period={date:'2026-11-25',start:'2026-11-24T16:00:00.000Z',end:'2026-11-25T16:00:00.000Z'};
  const after=report('A',[24,25,26],['-999 USD','-0.00000001 USD','800 USD']);
  after.asOf='2026-11-25T16:05:00.000Z';
  after.coverageStart=period.start;
  const times=['2026-11-24T15:59:59.999999999Z',period.start,period.end];
  for(const [i,p] of after.positions.entries())p.opened=p.closed=after.fills[i].time=times[i];
  after.parameters={afterCutoff:999};
  after.fills[1].commission='0.00000001 ETH';
  const earlier=structuredClone(after);
  earlier.id='00000000-0000-4000-8000-000000000099';
  after.positions[1].openingTradeId=earlier.positions[1].tradeIds[0];
  after.positions[1].tradeIds=['exit-only'];after.positions[1].id='NETTING-CYCLE-SNAPSHOT';
  earlier.asOf='2026-11-25T15:59:59.999999999Z';earlier.parameters={lookback:5};
  const last=earlier.asOf;
  earlier.fills.push({...earlier.fills[1],tradeId:'archived',time:last,commission:'-0.00000002 ETH'});
  earlier.positions.push({...earlier.positions[1],id:'archived',opened:last,closed:last,tradeIds:['archived'],realizedPnl:'0.00000002 USD'});
  const carry={...after.positions[0],id:'overnight',opened:time(24),closed:time(27),tradeIds:['carry-open'],realizedPnl:'90000 PRIVATE',peakQuantity:'1234567'};
  after.positions.push(carry);
  assert.equal(hasDailyActivity({...after,fills:[],positions:[carry]},period),true);
  assert.equal(hasDailyActivity({...after,fills:[],positions:[after.positions[2]]},period),false);
  assert.equal(hasDailyActivity({...after,coverageStart:period.end},period),false);
  const context=reviewContext([earlier,after],'','zh-CN',period);
  assert.deepEqual(context.period,period);
  assert.equal(context.reports.length,1);
  const [day]=context.reports;
  assert.equal(day.fillCount,2);assert.equal(day.closedPositionCount,2,'renamed NETTING snapshot represents the original cycle');assert.equal(day.openPositionCount,1);
  assert.equal(day.hasDayCapture,true);
  const usd=day.currencies.find(c=>c.currency==='USD')!,eth=day.currencies.find(c=>c.currency==='ETH')!;
  assert.equal(Number(usd.realizedPnl),1e-8);assert.equal(Number(usd.maxDrawdown),1e-8);assert.equal(usd.winRate,.5);
  assert.equal(Number(eth.fees),-1e-8);assert.equal(usd.profitFactor,2);
  assert.equal(day.parameters[0].ref,earlier.id+'/parameter/lookback');
  assert.equal(day.fills.find(f=>f.tradeId==='archived')!.ref.split('/')[0],earlier.id);
  assert.equal(day.carriedPositions![0].id,'overnight');
  assert.doesNotMatch(JSON.stringify(day),/90000 PRIVATE|1234567|afterCutoff|800 USD|-999 USD/);
  const partial=reviewContext([earlier],'','zh-CN',period).reports[0];
  assert.equal(partial.openPositionCount,null);
  assert.equal(partial.instruments[0].openLong,null);
});
