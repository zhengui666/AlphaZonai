import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {getSupportedThinkingLevels} from '@earendil-works/pi-ai/models';
import type {Credential,CredentialStore} from '@earendil-works/pi-ai';

export type ServiceTier='default'|'priority';
export type ModelChoice={model:string;thinking:string;speed:ServiceTier|null};
type State={openai?:Credential;defaults?:ModelChoice};
export function speedTiers(model:{provider:string;api:string}):ServiceTier[]{
  return model.provider==='openai'&&model.api==='openai-responses' ? ['default','priority'] : [];
}
export function modelView(model:Parameters<typeof getSupportedThinkingLevels>[0]){
  return {id:model.id,name:model.name,thinking:getSupportedThinkingLevels(model),speed:speedTiers(model)};
}
export function choice(raw:any, available:ReturnType<typeof modelView>[]):ModelChoice{
  if(typeof raw?.model!=='string'||!raw.model)throw Error('MODEL_REQUIRED');
  const m=available.find(m=>m.id===raw.model);
  if(!m)throw Error('MODEL_UNKNOWN');
  const thinking=raw.thinking||'off';
  if(typeof thinking!=='string'||!m.thinking.some(t=>t===thinking))throw Error('THINKING_UNSUPPORTED');
  const speed=raw.speed??null;
  if(speed!==null&&!m.speed.includes(speed))throw Error('SPEED_UNSUPPORTED');
  return {model:m.id,thinking,speed};
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
    read:async id=>id==='openai'?(await read()).openai:undefined,
    list:async()=>{const s=await read();return s.openai?[{providerId:'openai',type:s.openai.type}]:[];},
    modify:async(id,fn)=>{
      if(id!=='openai')throw Error('MODEL_UNKNOWN');
      return edit(async s=>{
        const out=await fn(s.openai);
        if(out)s.openai=out;
        return s.openai;
      });
    },
    delete:async id=>{if(id==='openai')await edit(async s=>{delete s.openai;});},
  };
  return {credentials,
    defaults:async()=>(await read()).defaults??null,
    save:async(defaults:ModelChoice)=>edit(async s=>{s.defaults=defaults;return defaults;}),
    savedKey:async()=>(await read()).openai?.type==='api_key',
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
