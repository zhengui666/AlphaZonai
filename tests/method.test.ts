import {test} from 'node:test';
import assert from 'node:assert/strict';
import {metrics,paper,roles,select, type Candidate} from '../src/method.ts';
const row=(id:string,v:number[])=>({id,parents:[],operation:'seed',role:'test',mode:'test',revisions:[],reviews:[],scores:Object.fromEntries(metrics.map((k,i)=>[k,v[i]]))} as Candidate);
test('all seven role tiers and 21 roles',()=>{assert.equal(roles.length,21);assert.equal(new Set(roles.map(x=>x.tier)).size,7);});
test('selects per metric; invalid and tied candidates do not silently enter',()=>{
  const a=row('a',[1,1,1,1,1]), b=row('b',[.1,.1,.1,.1,.1]), c=row('c',[20,20,20,20,0]);
  const first=select([a,b,c],[],paper);
  assert.deepEqual(first.parents,[]);
  const second=select([a,b],[],paper);
  assert.deepEqual(second.elites.map(x=>x.id),['a']);
  assert.deepEqual(select([b,a],[],paper).elites,second.elites);
  assert.deepEqual(select([a],[],paper).parents,[]);
  assert.deepEqual(select([b],second.elites,paper).parents.map(x=>x.id),['a']);
});
