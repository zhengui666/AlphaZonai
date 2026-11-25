import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createModels} from '@earendil-works/pi-ai/models';
import {openaiCodexProvider} from '@earendil-works/pi-ai/providers/openai-codex';
import {openaiProvider} from '@earendil-works/pi-ai/providers/openai';
import {choice,isLocalSettingsHost,modelStore,modelView,providerSpeed,recordedStrategyModel} from '../src/model-settings.ts';

test('model settings survive a restart and secret storage remains private',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'az-model-'));
  try{
    const first=modelStore(dir);
    const model=openaiProvider().getModels().find(x=>x.id==='gpt-5.4')!;
    const defaultChoice=choice({model:model.id,thinking:'off',speed:'priority'},[modelView(model)]);
    await Promise.all([
      first.credentials.modify('openai',async()=>({type:'api_key',key:'unit-test-only-key'})),
      first.save(defaultChoice),
    ]);
    const fresh=modelStore(dir);
    assert.equal((await stat(join(dir,'model-settings.json'))).mode&0o777,0o600);
    assert.deepEqual(await fresh.defaults(),defaultChoice);
    assert.deepEqual(await fresh.credentials.list(),[{providerId:'openai',type:'api_key'}]);
    const models=createModels({credentials:fresh.credentials});
    models.setProvider(openaiProvider());
    assert.equal((await models.getAuth('openai'))?.auth.apiKey,'unit-test-only-key');
    await fresh.credentials.delete('openai');
    assert.equal(await fresh.savedKey(),false);
    assert.deepEqual(await fresh.defaults(),defaultChoice);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('model choices reject unsupported intensity and map only supported service tier',()=>{
  const provider=openaiProvider();
  const model=provider.getModels().find(m=>!m.reasoning&&m.api==='openai-responses')!;
  const view=modelView(model);
  assert.throws(()=>choice({model:model.id,thinking:'high'},[view]),/THINKING_UNSUPPORTED/);
  assert.throws(()=>choice({model:model.id,speed:'ultra-fast'},[view]),/SPEED_UNSUPPORTED/);
  const known=provider.getModels().find(x=>x.id==='gpt-5.4')!;
  const unknown={...model,id:'unlisted-model'};
  assert.throws(()=>choice({model:unknown.id,speed:'priority'},[modelView(unknown)]),/SPEED_UNSUPPORTED/);
  const payload={model:known.id,max_output_tokens:4096};
  assert.deepEqual(providerSpeed(payload,known,'priority'),{...payload,service_tier:'priority'});
  assert.equal(providerSpeed(payload,unknown,'priority'),payload);
  assert.equal(providerSpeed(payload,model,null),payload);
  assert.equal(providerSpeed(payload,{provider:'other',api:'responses'},'priority'),payload);
  assert.equal(isLocalSettingsHost('127.0.0.1:25447'),true);
  assert.equal(isLocalSettingsHost('127.0.0.1.example.org'),false);
});

test('ChatGPT choices are distinct from API models with the same id',()=>{
  const cp=openaiCodexProvider().getModels()[0], ap=openaiProvider().getModels()[0];
  const api={...modelView(ap),id:cp.id};
  const subscription=modelView(cp);
  assert.throws(()=>choice({provider:'openai-codex',model:cp.id,speed:'priority'},[api,subscription]),/SPEED_UNSUPPORTED/);
  const selected=choice({provider:'openai-codex',model:cp.id,thinking:'off',speed:'default'},[api,subscription]);
  assert.equal(selected.provider,'openai-codex');
  assert.deepEqual(providerSpeed({model:cp.id},cp,selected.speed),{model:cp.id,service_tier:'default'});
  assert.equal(choice({model:cp.id},[api,subscription]).provider,'openai');
});

test('strategy builds preserve the research provider, reasoning and explicit service tier',()=>{
  const codex=openaiCodexProvider().getModels()[0];
  const traditional=openaiProvider().getModels()[0];
  const options=[modelView(codex),modelView(traditional)];
  const thinking=getNonOff(options[0].thinking);
  const run={provider:'openai-codex',model:codex.id,thinking,speed:'default'};
  assert.deepEqual(recordedStrategyModel(run,options),run);
  assert.throws(()=>recordedStrategyModel(run,options.slice(1)),/MODEL_UNKNOWN/);
  assert.deepEqual(recordedStrategyModel({model:traditional.id},options),{provider:'openai',model:traditional.id,thinking:'off',speed:null});
});
function getNonOff(values:readonly string[]){
  return values.find(x=>x!=='off')??'off';
}
