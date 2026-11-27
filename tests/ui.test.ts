import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {packs} from '../web/locale.js';
import {reviewLabel,reviewPath,reviewRoute} from '../web/reviews.js';
import {settingsPatch} from '../web/settings.js';

test('English and Simplified Chinese cover every static and runtime UI label',async()=>{
  const template=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
  const scripts=await Promise.all(['app','reviews','settings'].map(name=>readFile(new URL('../web/'+name+'.js',import.meta.url),'utf8')));
  assert.deepEqual(Object.keys(packs.en).sort(),Object.keys(packs['zh-CN']).sort());
  for(const match of template.matchAll(/data-i="([^"]+)"/g)){
    for(const pack of Object.values(packs))assert.ok(pack[match[1]], match[1]);
  }
  for(const match of scripts.join('\n').matchAll(/\bt\('([^']+)'\)/g)){
    for(const pack of Object.values(packs))assert.ok(pack[match[1]], match[1]);
  }
});

test('review references reopen the source mode and preserve native identifiers',()=>{
  const id='00000000-0000-4000-8000-000000000042';
  const parts=['fill','BTC/USDT','order+1','成交?#%'];
  const hash=reviewPath('live',id,parts.map(encodeURIComponent).join('/'));
  assert.deepEqual(reviewRoute(hash.slice(1)),{mode:'live',id,parts});
  assert.equal(reviewRoute('performance/paper')?.id,undefined);
  assert.equal(reviewRoute('settings/review'),undefined);
});

test('saving a section sends edited fields and preserves a token until explicitly cleared or replaced',()=>{
  const saved={python:'python3',targets:[{id:'node',roles:['deploy']}]};
  const token={name:'strategyToken',value:''};
  assert.deepEqual(settingsPatch(saved,{...structuredClone(saved),python:'/bin/python'},token,false),{python:'/bin/python'});
  assert.deepEqual(settingsPatch(saved,saved,token,true),{strategyToken:''});
  assert.deepEqual(settingsPatch(saved,{...saved,targets:[]},{...token,value:'replacement'},false),{targets:[],strategyToken:'replacement'});
});

test('history identifies daily reviews by trading day and existing manual reviews by submission',()=>{
  const t=(k:string)=>packs['zh-CN'][k];
  const manual={created:'2026-11-27',status:'completed'};
  assert.equal(reviewLabel(manual,t,String),'手动复盘 · 2026-11-27 UTC · 复盘完成');
  assert.equal(reviewLabel({...manual,trigger:'daily',period:{date:'2026-11-26'}},t,String),'每日自动复盘 · 2026-11-26 · 复盘完成');
});
