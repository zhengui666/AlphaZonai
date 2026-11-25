import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizedStrategyWrite,strategyEvidence,validateStrategyPlan} from '../src/strategy.ts';
const plan={title:'Control',signals:[{kind:'return',lookback:5,scale:1,weight:1}],entry:.2,exit:.01,stop_loss:.01,allocation:.4,max_positions:2};

test('strategy specification is data, not executable source',()=>{
  assert.deepEqual(validateStrategyPlan(plan),plan);
  assert.throws(()=>validateStrategyPlan({...plan,python:'print(1)'}),/STRATEGY_PLAN_INVALID/);
  assert.throws(()=>validateStrategyPlan({...plan,entry:.01,exit:.02}),/STRATEGY_PLAN_INVALID/);
  assert.throws(()=>validateStrategyPlan({...plan,signals:[...plan.signals,...plan.signals]}),/STRATEGY_PLAN_INVALID/);
  assert.throws(()=>validateStrategyPlan({...plan,allocation:Infinity}),/STRATEGY_PLAN_INVALID/);
});

test('bearer authorizes writes, absence and mismatches do not',()=>{
  assert.equal(authorizedStrategyWrite('Bearer configured','configured'),true);
  assert.equal(authorizedStrategyWrite('Bearer misconfigured','configured'),false);
  assert.equal(authorizedStrategyWrite(undefined,'configured'),false);
  assert.equal(authorizedStrategyWrite('Bearer anything',''),false);
});

test('only selected evidence is handed to strategy generation',()=>{
  const r={generations:[{elites:['1.2'],rows:[{id:'1.2',revisions:[{name:'One',formula:'some formula',code:'not supplied'}]},{id:'1.3',revisions:[]}]}]};
  const e=strategyEvidence(r);
  assert.equal(e.length,1);
  assert.equal(e[0].id,'1.2');
  assert.equal(Object.hasOwn(e[0],'code'),false);
});
