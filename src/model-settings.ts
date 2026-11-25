import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {getSupportedThinkingLevels,type Models} from '@earendil-works/pi-ai/models';
import type {Credential,CredentialStore} from '@earendil-works/pi-ai';

export type ServiceTier='default'|'priority';
export type ModelProvider='openai'|'openai-codex';
export type ModelChoice={provider:ModelProvider;model:string;thinking:string;speed:ServiceTier|null};
type State=Partial<Record<ModelProvider,Credential>> & {defaults?:ModelChoice};
const providerId=(id:string):id is ModelProvider=>id==='openai'||id==='openai-codex';
export function speedTiers(model:{provider:string;api:string}):ServiceTier[]{
  return (model.provider==='openai'&&model.api==='openai-responses')||(model.provider==='openai-codex'&&model.api==='openai-codex-responses') ? ['default','priority'] : [];
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
export function providerSpeed(payload:Record<string,unknown>, model:{provider:string;api:string}, speed:unknown){
  return (speed==='default'||speed==='priority')&&speedTiers(model).includes(speed)
    ? {...payload,service_tier:speed} : payload;
}
export function isLocalSettingsHost(value:string|undefined){
  return typeof value==='string'&&/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(value);
}
export function modelStore(dir:string){
  const file=join(dir,'model-settings.json');
  let tail:Promise<unknown>=Promise.resolve();
  async function read():Promise<State>{
    try{return JSON.parse(await readFile(file,'utf8'));}catch(e:any){if(e.code==='ENOENT')return {};throw e;}
  }
  function edit<T>(fn:(s:State)=>Promise<T>){
    const op=tail.then(async()=>{
      await mkdir(dir,{recursive:true});
      const s=await read(), out=await fn(s);
      const tmp=join(dir,'.model-settings-'+randomUUID());
      try{
        await writeFile(tmp,JSON.stringify(s),{mode:0o600,flag:'wx'});
        await rename(tmp,file);
      }finally{await rm(tmp,{force:true});}
      return out;
    });
    tail=op.catch(()=>{});
    return op;
  }
  const credentials:CredentialStore={
    read:async id=>providerId(id)?(await read())[id]:undefined,
    list:async()=>{const s=await read();return (['openai','openai-codex'] as const).flatMap(id=>s[id]?[{providerId:id,type:s[id].type}]:[]);},
    modify:async(id,fn,options)=>{
      if(!providerId(id))throw Error('MODEL_UNKNOWN');
      return edit(async s=>{
        options?.signal?.throwIfAborted();
        const out=await fn(s[id]);
        if(out)s[id]=out;
        return s[id];
      });
    },
    delete:async id=>{if(providerId(id))await edit(async s=>{delete s[id];});},
  };
  return {credentials,
    defaults:async()=>(await read()).defaults??null,
    save:async(defaults:ModelChoice)=>edit(async s=>{s.defaults=defaults;return defaults;}),
    savedKey:async()=>(await read()).openai?.type==='api_key',
    savedChatGPT:async()=>(await read())['openai-codex']?.type==='oauth',
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
