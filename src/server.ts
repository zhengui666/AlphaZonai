import {createServer} from 'node:http';
import {mkdir, readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {Harness,createRegistry,configure} from '@earendil-works/pi-durable';
import {openNodeSqliteStorage} from '@earendil-works/pi-durable/storage/sqlite/node';
import {createModels} from '@earendil-works/pi-ai/models';
import {openaiProvider} from '@earendil-works/pi-ai/providers/openai';
import {openaiCodexProvider} from '@earendil-works/pi-ai/providers/openai-codex';
import {createCogAlpha,Runs,Resume,setModelSpeed} from './extension.ts';
import {paper,minute} from './method.ts';
import {chatGPTLogin,checkOpenAIKey,choice,isLocalSettingsHost,modelStore,modelView,recordedStrategyModel} from './model-settings.ts';

import {authorizedStrategyWrite,readTargets,strategyEvidence,strategyId} from './strategy.ts';

const state=resolve(process.env.ALPHA_STATE||'state');
const catalog=resolve(process.env.ALPHA_CATALOG||'/catalog');
const modelPrefs=modelStore(state);
const models=createModels({credentials:modelPrefs.credentials});
models.setProvider(openaiProvider());
models.setProvider(openaiCodexProvider());
const chatGPT=chatGPTLogin(models);
const registry=createRegistry();
const {extension,Run,StrategyBuild,StrategyPush}=createCogAlpha();
registry.install(extension);
await mkdir(state,{recursive:true});
const harness=await Harness.open(await openNodeSqliteStorage(join(state,'pi.sqlite')),{models,registry},ctx);
const root=await harness.root(ctx);
harness.resume();

const site=fileURLToPath(new URL('../web/',import.meta.url));
const assets:Record<string,string>={'/':'index.html','/style.css':'style.css','/app.js':'app.js','/locale.js':'locale.js'};
const mime:Record<string,string>={html:'text/html',css:'text/css',js:'text/javascript'};
const snapshot=async()=>((await harness.snapshot(Runs,root.id,ctx))?.runs||{}) as Record<string,any>;
const send=(res:any,status:number,result:any)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));};
async function body(req:any){
  let data='';for await(const b of req){data+=b;if(data.length>16000)throw new Error('BAD_REQUEST');}
  try{return JSON.parse(data);}catch{throw new Error('BAD_REQUEST');}
}
const availableModels=async()=>(await models.getAvailable()).map(modelView);
async function settings(local:boolean){
  const stored=await modelPrefs.savedKey();
  return {connected:Boolean(await models.checkAuth('openai')),stored,chatGPTConnected:await modelPrefs.savedChatGPT(),
    chatGPT:local?chatGPT.view():null,defaults:await modelPrefs.defaults(),models:await availableModels(),writable:local};
}
async function input(raw:any){
  const validDate=(x:unknown)=>typeof x==='string'&&/^\d{4}-\d\d-\d\d$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
  if(!raw||!['paper','minute'].includes(raw.preset)||!validDate(raw.start)||!validDate(raw.end)||raw.start>=raw.end)throw new Error('INVALID_DATES');
  const horizon=Number(raw.horizon),seed=Number(raw.seed);
  if(!Number.isSafeInteger(horizon)||horizon<1||!Number.isSafeInteger(seed))throw new Error('BAD_REQUEST');
  const defaults=await modelPrefs.defaults();
  const available=await availableModels();
  if(!available.length)throw Error('MODEL_CREDENTIAL');
  const selected=choice({provider:raw.provider??(raw.model?'openai':defaults?.provider),model:raw.model||defaults?.model,thinking:raw.thinking??defaults?.thinking,
    speed:raw.speed===''?null:raw.speed??defaults?.speed},available);
  const rules={...(raw.preset==='paper'?paper:minute)};
  for(const key of ['parallel','generations','plateauWindow'] as const){
    const num=raw[key];
    if(num!==undefined&&num!==''&&raw.preset==='minute'){
      const n=Number(num);
      if(!Number.isSafeInteger(n)||n<(key==='plateauWindow'?0:1))throw new Error('BAD_REQUEST');
      rules[key]=n;
    }
  }
  return {preset:raw.preset,catalog,barSpec:'1-MINUTE-LAST',...selected,start:raw.start,end:raw.end,horizon,seed,rules};
}
function strategyDate(x:any){
  if(typeof x!=='string'||!/^\d{4}-\d\d-\d\d$/.test(x)||!Number.isFinite(Date.parse(x)))return null;
  const date=new Date(x).toISOString();
  return date.slice(0,10)===x?date:null;
}
const server=createServer(async (req,res)=>{
  try{
    const url=new URL(req.url||'/', 'http://localhost');
    const path=url.pathname;
    const method=req.method;
    if(method==='GET'&&Object.hasOwn(assets,path)){
      const name=assets[path];res.writeHead(200,{'Content-Type':mime[name.split('.').at(-1)!]+';charset=utf-8','Content-Security-Policy':"default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(await readFile(join(site,name)));return;
    }
    if(method==='POST' && (req.headers.origin && new URL(req.headers.origin).host!==req.headers.host || !req.headers['content-type']?.startsWith('application/json')))return send(res,403,{error:'BAD_REQUEST'});
    if(path==='/api/strategy-targets'&&method==='GET'){
      const targets=await readTargets();
      return send(res,200,{targets:targets.map(({id,label,roles})=>({id,label,roles})),enabled:Boolean(process.env.ALPHA_STRATEGY_TOKEN)});
    }
    if(path==='/api/models'&&method==='GET')return send(res,200,{models:await availableModels()});
    if(path==='/api/model-settings'&&method==='GET')return send(res,200,await settings(isLocalSettingsHost(req.headers.host)));
    if(path==='/api/model-settings'&&method==='POST'){
      if(!isLocalSettingsHost(req.headers.host)||!req.headers.origin)return send(res,403,{error:'MODEL_SETTINGS_LOCAL'});
      const raw=await body(req);
      if(raw?.action==='connect'){
        const key=await checkOpenAIKey(raw.key);
        await modelPrefs.credentials.modify('openai',async()=>({type:'api_key',key}));
      }else if(raw?.action==='disconnect'){
        await modelPrefs.credentials.delete('openai');
      }else if(raw?.action==='chatgpt-start'){
        chatGPT.start();
      }else if(raw?.action==='chatgpt-cancel'){
        chatGPT.cancel();
      }else if(raw?.action==='chatgpt-disconnect'){
        chatGPT.cancel();await models.logout('openai-codex');
      }else if(raw?.action==='defaults'){
        await modelPrefs.save(choice(raw,await availableModels()));
      }else throw Error('BAD_REQUEST');
      return send(res,200,await settings(true));
    }
    if(path==='/api/runs'&&method==='GET'){
      const runs=await snapshot();
      return send(res,200,Object.values(runs).map(({id,preset,status,created,current,progress})=>({id,preset,status,created,current,progress})).reverse());
    }
    if(path==='/api/runs'&&method==='POST'){
      const raw=await body(req),config=await input(raw);
      const id=raw.id;
      if(typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id))throw new Error('BAD_REQUEST');
      await root.commit(async tx=>{
        const runs=(await tx.doc(Runs,root.id)).runs;
        if(runs[id])return;
        const conversation=await tx.createConversation({ownership:{kind:'ownerless'}});
        await configure(tx,conversation.id,{model:{provider:config.provider,modelId:config.model},thinkingLevel:config.thinking,maxTurns:1,tools:[]});
        await setModelSpeed(tx,conversation.id,config.speed);
        // The run owns Agent work in a separate configured conversation; records
        // are surfaced via the root Pi document using that address in the input.
        const task=await tx.createTask(Run,{...config,id,docId:root.id},{ownership:{kind:'conversation'},conversationId:conversation.id});
        runs[id]={id,task,preset:config.preset,provider:config.provider,model:config.model,thinking:config.thinking,speed:config.speed,input:{start:config.start,end:config.end,horizon:config.horizon,seed:config.seed,barSpec:config.barSpec},status:'queued',created:new Date().toISOString(),generations:[],current:0,limit:config.rules.generations};
      },ctx);
      harness.resume();
      return send(res,202,{id});
    }
    const m=path.match(/^\/api\/runs\/([0-9a-f-]{36})(?:\/(events|actions|export|strategies))?$/);
    if(m){
      const [,id,action]=m;
      const run=(await snapshot())[id];
      if(!run)return send(res,404,{error:'NOT_FOUND'});
      if(!action&&method==='GET')return send(res,200,run);
      if(action==='strategies'&&method==='POST'){
        if(!authorizedStrategyWrite(req.headers.authorization))return send(res,401,{error:'STRATEGY_AUTH_REQUIRED'});
        const raw=await body(req);
        if(typeof raw?.id!=='string'||!strategyId.test(raw.id)||typeof raw.target!=='string'||!['build','push'].includes(raw.action))
          return send(res,400,{error:'BAD_REQUEST'});
        const selectedTarget=(await readTargets()).find(x=>x.id===raw.target);
        if(!selectedTarget?.roles.includes(raw.action==='build'?'backtest':'deploy'))return send(res,404,{error:'STRATEGY_TARGET_MISSING'});
        if(raw.action==='build'){
          const provider=run.provider??'openai';
          if(!await models.checkAuth(provider))return send(res,400,{error:'MODEL_CREDENTIAL'});
          const tracked=recordedStrategyModel(run,await availableModels());
          if(run.status!=='completed')return send(res,409,{error:'STRATEGY_RUN_INCOMPLETE'});
          if(raw.brief!==undefined&&(typeof raw.brief!=='string'||raw.brief.length>2000))return send(res,400,{error:'BAD_REQUEST'});
          const brief=(raw.brief??'').trim();
          const evidence=strategyEvidence(run);
          if(!evidence.length)return send(res,409,{error:'STRATEGY_NO_ELITES'});
          const start=strategyDate(raw.start),end=strategyDate(raw.end),researchEnd=strategyDate(run.input.end);
          if(!start||!end||!researchEnd||start<researchEnd||end<=start)
            return send(res,400,{error:'STRATEGY_BACKTEST_DATES'});
          const result=await root.commit(async tx=>{
            const r=(await tx.doc(Runs,root.id)).runs[id];
            r.strategies??={};
            const existing=r.strategies[raw.id];
            if(existing)return existing.target===raw.target&&existing.start===start&&existing.end===end&&existing.brief===brief;
            const conversation=await tx.createConversation({ownership:{kind:'ownerless'}});
            await configure(tx,conversation.id,{model:{provider:tracked.provider,modelId:tracked.model},thinkingLevel:tracked.thinking,maxTurns:1,tools:[]});
            await setModelSpeed(tx,conversation.id,tracked.speed);
            const task=await tx.createTask(StrategyBuild,{docId:root.id,runId:id,id:raw.id,target:raw.target,start,end,researchEnd,evidence,brief,marketContext:selectedTarget.marketContext??'',researchBarSpec:r.input.barSpec,modelSettings:tracked},
              {ownership:{kind:'conversation'},conversationId:conversation.id});
            r.strategies[raw.id]={task,id:raw.id,status:'generating',target:raw.target,start,end,brief,modelSettings:tracked,deployments:{}};
            return true;
          },ctx);
          if(!result)return send(res,409,{error:'STRATEGY_ID_CONFLICT'});
        }else{
          if(run.strategies?.[raw.id]?.status!=='validated')return send(res,409,{error:'STRATEGY_NOT_VALIDATED'});
          await root.commit(async tx=>{
            const item=(await tx.doc(Runs,root.id)).runs[id].strategies[raw.id];
            const prior=Object.hasOwn(item.deployments,raw.target)?item.deployments[raw.target]:undefined;
            if(prior&&prior.status!=='failed')return;
            const task=await tx.createTask(StrategyPush,{docId:root.id,runId:id,id:raw.id,target:raw.target,bundle:item.bundle},
              {ownership:{kind:'conversation'},conversationId:root.id});
            item.deployments[raw.target]={task,status:'pushing'};
          },ctx);
        }
        harness.resume();
        return send(res,202,{id:raw.id});
      }
      if(action==='strategies'&&method==='GET'&&url.searchParams.has('download')){
        const item=run.strategies?.[url.searchParams.get('download')!];
        if(!item?.bundle)return send(res,404,{error:'NOT_FOUND'});
        res.setHeader('Content-Disposition','attachment; filename="alphazonai-strategy-package.json"');
        return send(res,200,item.bundle);
      }
      if(action==='export'&&method==='GET'){
        const selected=new Set(run.generations.flatMap((g:any)=>g.elites));
        const rows=run.generations.flatMap((g:any)=>g.rows).filter((x:any)=>selected.has(x.id)).map((x:any)=>({id:x.id,parents:x.parents,scores:x.scores,...x.revisions.at(-1)}));
        res.setHeader('Content-Disposition','attachment; filename="alphazonai-factors.json"');
        return send(res,200,{schemaVersion:1,run:id,preset:run.preset,provider:run.provider??'openai',model:run.model,thinking:run.thinking,speed:run.speed??null,input:run.input,coverage:run.coverage??null,factors:rows});
      }
      if(action==='events'&&method==='GET'){
        const watch=await harness.watchDoc(Runs,root.id,ctx);
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'});
        const push=(value:any)=>{if(!res.writableEnded&&value?.runs?.[id])res.write('data: '+JSON.stringify(value.runs[id])+'\n\n');};
        const pulse=setInterval(()=>{if(!res.writableEnded)res.write(': keepalive\n\n');},15000);
        res.on('close',()=>{clearInterval(pulse);watch.stop();});
        push(watch.value);
        watch.start(async (call:any)=>{if(call.kind==='value')push(call.value);});
        return;
      }
      if(action==='actions'&&method==='POST'){
        const {action:command}=await body(req);
        if(!['pause','resume','stop'].includes(command))return send(res,400,{error:'BAD_REQUEST'});
        if(['failed','completed','stopped'].includes(run.status))return send(res,409,{error:'RUN_TERMINAL'});
        if(command==='stop'){await harness.abortTask(run.task,ctx);return send(res,202,{id});}
        await root.commit(async tx=>{
          const r=(await tx.doc(Runs,root.id)).runs[id];
          if(['failed','completed','stopped'].includes(r.status))return;
          if(command==='pause'){r.pause=true;if(r.status!=='paused')r.status='pausing';}
          else {if(r.status==='paused')await tx.signal(r.task,Resume,`generation:${r.waitingFor}`,{action:'resume'});r.pause=false;r.status='running';}
        },ctx);
        harness.resume();
        return send(res,202,{id});
      }
    }
    return send(res,404,{error:'NOT_FOUND'});
  } catch(e:any){
    const known=['BAD_REQUEST','INVALID_DATES','MODEL_REQUIRED','MODEL_UNKNOWN','THINKING_UNSUPPORTED','SPEED_UNSUPPORTED','MODEL_KEY_INVALID','MODEL_CONNECTION_FAILED','MODEL_CREDENTIAL'];
    if(!known.includes(e.message))console.error(e);
    if(!res.headersSent)send(res,known.includes(e.message)?400:500,{error:known.includes(e.message)?e.message:'SERVER_ERROR'});
    else res.end();
  }
});
server.listen(Number(process.env.PORT||8787),process.env.ALPHA_HOST||'127.0.0.1');
for(const sig of ['SIGINT','SIGTERM'])process.once(sig,async ()=>{server.close();server.closeAllConnections();await harness.close(ctx);process.exit(0);});
