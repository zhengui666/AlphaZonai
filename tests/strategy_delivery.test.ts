import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizedStrategyWrite,callTarget,strategyEvidence,strategyWindow,validateStrategyPlan,validateTargets} from '../src/strategy.ts';
const plan={title:'Control',strategyClass:'MyStrategy',configClass:'MyConfig',
  source:'class MyStrategy(Strategy):\n  pass\nclass MyConfig(StrategyConfig):\n  pass',config:{unknownConfigChoice:42}};

test('strategy holdout starts at or after the catalog query end, including sub-millisecond timestamps',()=>{
  const requested={start:'2026-10-08',end:'2026-10-09'};
  const midnight=BigInt(Date.parse(requested.start))*1_000_000n;
  const research=(nanos:bigint)=>({input:{end:'2026-10-08T08:00+08:00'},coverage:{endExclusiveNs:String(nanos)}});
  const expected={start:'2026-10-08T00:00:00.000Z',end:'2026-10-09T00:00:00.000Z',researchEnd:'2026-10-08T00:00:00.000Z'};
  assert.equal(strategyWindow(research(midnight+1n),requested),null);
  assert.deepEqual(strategyWindow(research(midnight-1n),requested),expected);
  assert.deepEqual(strategyWindow(research(midnight),requested),expected);
  assert.deepEqual(strategyWindow({input:{end:'2026-10-08'}},requested),expected);
});

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

test('receiver settings accept local and SSH targets and restrict each target to its saved roles',async()=>{
  const local={id:'history',label:'History',kind:'local',roles:['backtest'],profile:'/etc/alpha/history.json'};
  const remote={id:'stage',label:'Staging',kind:'ssh',roles:['deploy'],alias:'alpha-stage',sshConfig:'/etc/alpha/ssh/config'};
  const targets=validateTargets([local,remote]);
  assert.deepEqual(targets,[local,remote]);
  assert.throws(()=>validateTargets([local,local]),/STRATEGY_TARGET_CONFIG/);
  assert.throws(()=>validateTargets([{...remote,sshConfig:'relative'}]),/STRATEGY_TARGET_CONFIG/);
  await assert.rejects(callTarget({python:'python3',targets},'history','stage',{},new AbortController().signal),/STRATEGY_TARGET_MISSING/);
});

test('only shortlisted factor evidence is supplied as data for strategy generation',()=>{
  const r={generations:[{elites:['1.2'],rows:[{id:'1.2',revisions:[{name:'One',formula:'some formula',code:'factor source'}]},{id:'1.3',revisions:[]}]}]};
  const e=strategyEvidence(r);
  assert.equal(e.length,1);
  assert.equal(e[0].id,'1.2');
  assert.equal(e[0].source,'factor source');
});
