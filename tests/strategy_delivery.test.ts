import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizedStrategyWrite,strategyEvidence,validateStrategyPlan} from '../src/strategy.ts';
const plan={title:'Control',strategyClass:'MyStrategy',configClass:'MyConfig',
  source:'class MyStrategy(Strategy):\n  pass\nclass MyConfig(StrategyConfig):\n  pass',config:{unknownConfigChoice:42}};

test('accepts arbitrary native source and rejects ambiguous or extraneous payloads',()=>{
  assert.deepEqual(validateStrategyPlan(plan),plan);
  assert.throws(()=>validateStrategyPlan({...plan,command:'anything'}),/STRATEGY_PLAN_INVALID/);
  assert.throws(()=>validateStrategyPlan({...plan,configClass:'MyStrategy'}),/STRATEGY_PLAN_INVALID/);
  assert.throws(()=>validateStrategyPlan({...plan,strategyClass:'other:Foreign'}),/STRATEGY_PLAN_INVALID/);
  assert.throws(()=>validateStrategyPlan({...plan,source:''}),/STRATEGY_PLAN_INVALID/);
});

test('bearer authorizes writes; absence and mismatches do not',()=>{
  assert.equal(authorizedStrategyWrite('Bearer configured','configured'),true);
  assert.equal(authorizedStrategyWrite('Bearer misconfigured','configured'),false);
  assert.equal(authorizedStrategyWrite(undefined,'configured'),false);
});

test('only shortlisted factor evidence is supplied as data for strategy generation',()=>{
  const r={generations:[{elites:['1.2'],rows:[{id:'1.2',revisions:[{name:'One',formula:'some formula',code:'factor source'}]},{id:'1.3',revisions:[]}]}]};
  const e=strategyEvidence(r);
  assert.equal(e.length,1);
  assert.equal(e[0].id,'1.2');
  assert.equal(e[0].source,'factor source');
});
