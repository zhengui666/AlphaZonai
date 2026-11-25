import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {packs} from '../web/locale.js';

test('English and Simplified Chinese cover every static and runtime UI label',async()=>{
  const template=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
  const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
  assert.deepEqual(Object.keys(packs.en).sort(),Object.keys(packs['zh-CN']).sort());
  for(const match of template.matchAll(/data-i="([^"]+)"/g)){
    for(const pack of Object.values(packs))assert.ok(pack[match[1]], match[1]);
  }
  for(const match of app.matchAll(/\bt\('([^']+)'\)/g)){
    for(const pack of Object.values(packs))assert.ok(pack[match[1]], match[1]);
  }
});
