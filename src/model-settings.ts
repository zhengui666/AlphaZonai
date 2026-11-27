import {createModels,getSupportedThinkingLevels,type Models} from '@earendil-works/pi-ai/models';
import {openaiProvider} from '@earendil-works/pi-ai/providers/openai';
import {openaiCodexProvider} from '@earendil-works/pi-ai/providers/openai-codex';
import type {Credential,CredentialStore} from '@earendil-works/pi-ai';
import type {settingsStore} from './settings.ts';

export type ServiceTier='default'|'priority';
export type ModelProvider='openai'|'openai-codex';
export type ModelChoice={provider:ModelProvider;model:string;thinking:string;speed:ServiceTier|null};
export type ModelState=Partial<Record<ModelProvider,Credential>> & {defaults?:ModelChoice};
const providerId=(id:string):id is ModelProvider=>id==='openai'||id==='openai-codex';
// Model discovery is owned by Pi. This separate metadata records documented
// API speed eligibility, not the models offered to a user or account entitlements.
// Source: https://openai.com/api-fast-mode/
const documentedApiFast=new Set([
  'gpt-6.2-astra','gpt-6.2-sol','gpt-6-astra','gpt-6.1-sol','gpt-6.1-terra','gpt-6-sol','gpt-6-luna',
  'gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','gpt-5.5','gpt-5.4-mini','gpt-5.4','gpt-5.2','gpt-5.1',
  'gpt-5','gpt-5-mini','gpt-5.1-codex','gpt-5-codex','gpt-4.1','gpt-4.1-mini','gpt-4.1-nano',
  'gpt-4o','gpt-4o-2024-11-20','gpt-4o-2024-08-06','gpt-4o-2024-05-13','gpt-4o-mini','o3','o4-mini',
]);
type SpeedModel={id?:string;provider:string;api:string};
export function speedTiers(model:SpeedModel):ServiceTier[]{
  if(model.provider==='openai'&&model.api==='openai-responses')
    return model.id&&documentedApiFast.has(model.id)?['default','priority']:['default'];
  // Published API pricing does not attest eligibility on a ChatGPT subscription.
  return model.provider==='openai-codex'&&model.api==='openai-codex-responses'?['default']:[];
}
export function modelView(model:Parameters<typeof getSupportedThinkingLevels>[0]){
  return {id:model.id,provider:model.provider,name:model.name,thinking:getSupportedThinkingLevels(model),speed:speedTiers(model)};
}
export function choice(raw:any, available:ReturnType<typeof modelView>[]):ModelChoice{
  if(typeof raw?.model!=='string'||!raw.model)throw Error('MODEL_REQUIRED');
  const provider=raw.provider??'openai';
  if(!providerId(provider))throw Error('MODEL_UNKNOWN');
  const m=available.find(m=>m.id===raw.model&&m.provider===provider);
  if(!m)throw Error('MODEL_UNKNOWN');
  const thinking=raw.thinking||'off';
  if(typeof thinking!=='string'||!m.thinking.some(t=>t===thinking))throw Error('THINKING_UNSUPPORTED');
  const speed=raw.speed??null;
  if(speed!==null&&!m.speed.includes(speed))throw Error('SPEED_UNSUPPORTED');
  return {provider,model:m.id,thinking,speed};
}
export function recordedStrategyModel(run:{provider?:string;model:string;thinking?:string;speed?:string|null},
  available:ReturnType<typeof modelView>[]):ModelChoice {
  return choice({provider:run.provider??'openai',model:run.model,thinking:run.thinking,speed:run.speed??null},available);
}
export function providerSpeed(payload:Record<string,unknown>, model:SpeedModel, speed:unknown){
  return (speed==='default'||speed==='priority')&&speedTiers(model).includes(speed)
    ? {...payload,service_tier:speed} : payload;
}
export function createSettingsModels(credentials:CredentialStore){
  // The OpenAI SDK also reads its own environment when constructing an authenticated request.
  for(const key of Object.keys(process.env))if(key.startsWith('OPENAI_'))delete process.env[key];
  const models=createModels({credentials,authContext:{env:async()=>undefined,fileExists:async()=>false}});
  models.setProvider(openaiProvider());
  models.setProvider(openaiCodexProvider());
  return models;
}
export function modelStore(store:ReturnType<typeof settingsStore>){
  const read=async()=>(await store.read()).model;
  const credentials:CredentialStore={
    read:async id=>providerId(id)?(await read())[id]:undefined,
    list:async()=>{const s=await read();return (['openai','openai-codex'] as const).flatMap(id=>s[id]?[{providerId:id,type:s[id].type}]:[]);},
    modify:async(id,fn,options)=>{
      if(!providerId(id))throw Error('MODEL_UNKNOWN');
      return store.edit(async ({model})=>{
        options?.signal?.throwIfAborted();
        const out=await fn(model[id]);
        if(out)model[id]=out;
        return model[id];
      });
    },
    delete:async id=>{if(providerId(id))await store.edit(({model})=>{delete model[id];});},
  };
  return {credentials,
    defaults:async()=>(await read()).defaults??null,
    save:async(defaults:ModelChoice)=>store.edit(({model})=>{model.defaults=defaults;return defaults;}),
  };
}
export async function checkOpenAIKey(value:unknown){
  if(typeof value!=='string'||value!==value.trim()||!/^[!-~]{16,512}$/.test(value))throw Error('MODEL_KEY_INVALID');
  let r:Response;
  try{
    r=await fetch('https://api.openai.com/v1/models',{headers:{Authorization:'Bearer '+value},
      redirect:'error',signal:AbortSignal.timeout(10_000)});
  }catch{throw Error('MODEL_CONNECTION_FAILED');}
  await r.body?.cancel();
  if(r.status===401||r.status===403)throw Error('MODEL_KEY_INVALID');
  if(!r.ok)throw Error('MODEL_CONNECTION_FAILED');
  return value;
}

type DeviceView={status:'idle'|'starting'|'waiting'|'connected'|'failed';code?:string;url?:string;expiresAt?:number};
export function chatGPTLogin(models:Models){
  let view:DeviceView={status:'idle'};
  let active:AbortController|undefined;
  return {
    view:()=>view,
    start(){
      if(active)return;
      const abort=new AbortController();
      active=abort;view={status:'starting'};
      const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(16*60_000)]);
      void models.login('openai-codex','oauth',{
        signal,
        async prompt(p){
          if(p.type==='select'&&p.options.some(x=>x.id==='device_code'))return 'device_code';
          throw Error('Unexpected login prompt');
        },
        notify(event){
          if(active!==abort||event.type!=='device_code')return;
          const url=new URL(event.verificationUri);
          if(url.origin!=='https://auth.openai.com')throw Error('Unexpected verification host');
          view={status:'waiting',code:event.userCode,url:url.toString(),expiresAt:Date.now()+1000*(event.expiresInSeconds??900)};
        },
      }).then(()=>{if(active===abort)view={status:'connected'};},
        ()=>{if(active===abort)view={status:'failed'};})
        .finally(()=>{if(active===abort)active=undefined;});
    },
    cancel(){active?.abort();active=undefined;view={status:'idle'};},
  };
}
