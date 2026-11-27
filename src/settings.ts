import {randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {isIP,type Socket} from 'node:net';
import {join,resolve} from 'node:path';
import {arr,bool,compile,int,obj,oneOf,opt,str,unknown} from '@earendil-works/pi-schema';
import type {ModelState} from './model-settings.ts';
import {validateTargets,type ReceiverSettings} from './strategy.ts';

export type ReviewSettings={enabled:boolean;time:string;language:'zh-CN'|'en';objective:string};
export const defaultReview:ReviewSettings={enabled:true,time:'08:00',language:'zh-CN',objective:''};
type Settings={
  model:ModelState;
  nautilus:ReceiverSettings & {strategyToken:string};
  review:ReviewSettings;
  data:{catalog:string;stateDir:string;host:string;port:number;agentToken:string};
};

export function localSettingsRequest(host:string|undefined,socket:Pick<Socket,'remoteAddress'|'localAddress'>,gateway?:string){
  const peer=socket.remoteAddress?.replace(/^::ffff:/,'');
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host??'')&&
    Boolean(peer&&(peer.startsWith('127.')||peer==='::1'||socket.remoteAddress===socket.localAddress||peer===gateway));
}

const pathValue=str({pattern:'^(?!\\s*$)[^\\u0000\\r\\n]+$'});
const token=str({pattern:'^[!-~]*$'});
const nautilusPatch=compile(obj({python:opt(pathValue),targets:opt(arr(unknown())),strategyToken:opt(token)}));
const reviewPatch=compile(obj({enabled:opt(bool()),time:opt(str({pattern:'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'})),
  language:opt(oneOf(['zh-CN','en'])),objective:opt(str({maxLength:2000}))}));
const dataPatch=compile(obj({catalog:opt(pathValue),stateDir:opt(pathValue),host:opt(str({minLength:1,maxLength:253})),
  port:opt(int({minimum:1,maximum:65535})),agentToken:opt(token)}));

export function applySettings(s:Settings,section:string,patch:unknown){
  if(section==='nautilus'&&nautilusPatch.check(patch)){
    const {targets,...rest}=patch;
    s.nautilus={...s.nautilus,...rest,targets:targets===undefined?s.nautilus.targets:validateTargets(targets)};
  }else if(section==='review'&&reviewPatch.check(patch)){
    s.review={...s.review,...patch};
    s.review.objective=s.review.objective.trim();
  }else if(section==='data'&&dataPatch.check(patch)){
    if(patch.host&&!isIP(patch.host)&&!patch.host.split('.').every(part=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part)))
      throw Error('BAD_REQUEST');
    s.data={...s.data,...patch};
    s.data.catalog=resolve(s.data.catalog);
    s.data.stateDir=resolve(s.data.stateDir);
  }else throw Error('BAD_REQUEST');
}

export function settingsStore(dir:string,defaultHost='127.0.0.1'){
  const file=join(dir,'settings.json');
  let tail:Promise<unknown>=Promise.resolve();
  async function read():Promise<Settings>{
    try{return JSON.parse(await readFile(file,'utf8'));}
    catch(e:any){if(e.code!=='ENOENT')throw e;}
    return {model:{},nautilus:{python:'python3',targets:[],strategyToken:''},review:{...defaultReview},
      data:{catalog:'/catalog',stateDir:resolve(dir),host:defaultHost,port:8787,agentToken:''}};
  }
  function edit<T>(change:(s:Settings)=>T|Promise<T>){
    const op=tail.then(async()=>{
      const s=await read(),result=await change(s);
      await mkdir(dir,{recursive:true,mode:0o700});
      const tmp=join(dir,'.settings-'+randomUUID());
      try{
        await writeFile(tmp,JSON.stringify(s),{mode:0o600,flag:'wx'});
        await rename(tmp,file);
      }finally{await rm(tmp,{force:true});}
      return result;
    });
    tail=op.catch(()=>{});
    return op;
  }
  return {read,edit};
}
