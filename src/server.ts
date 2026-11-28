import {createServer} from 'node:http';
import {mkdir, readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {Harness,createRegistry,configure,defineExtension,type Tx} from '@earendil-works/pi-durable';
import {openNodeSqliteStorage} from '@earendil-works/pi-durable/storage/sqlite/node';
import {createCogAlpha,Runs,Resume,setModelSpeed} from './extension.ts';
import {paper,minute} from './method.ts';
import {agentWriteError,researchDirection,runAdmission,sameRunAdmission} from './research-context.ts';
import {chatGPTLogin,checkOpenAIKey,choice,createSettingsModels,modelStore,modelView,recordedStrategyModel,type ModelChoice} from './model-settings.ts';
import {applySettings,cloudflareSettingsAccess,localSettingsRequest,settingsStore,type Settings} from './settings.ts';
import {authorizedStrategyWrite,strategyEvidence,strategyId,strategyWindow} from './strategy.ts';
import {importPerformance,performanceReport,PerformanceIndex,PerformanceReport} from './performance.ts';
import {Reviews,ReviewInputs,reviewRequest,sameReviewRequest} from './review.ts';
import {createDailySchedule,DailyScheduleState,ensureDailySchedule} from './daily-review.ts';

const container=process.argv.includes('--container');
const store=settingsStore(container?'/state':resolve('state'),container?'0.0.0.0':'127.0.0.1');
const {data:startup}=await store.read();
const nautilusSettings=async()=>(await store.read()).nautilus;
const modelPrefs=modelStore(store);
const models=createSettingsModels(modelPrefs.credentials);
const chatGPT=chatGPTLogin(models);
const registry=createRegistry();
const {extension,Run,StrategyBuild,StrategyPush,PerformanceReview}=createCogAlpha({stateDir:startup.stateDir,nautilusSettings});
registry.install(extension);
const DailySchedule=createDailySchedule({modelSettings:reviewModel,startReview});
registry.install(defineExtension({name:'alphazonai.daily',tasks:[DailySchedule]}));
await mkdir(startup.stateDir,{recursive:true});
const harness=await Harness.open(await openNodeSqliteStorage(join(startup.stateDir,'pi.sqlite')),{models,registry},ctx);
const root=await harness.root(ctx);
async function syncDailySchedule(){
  const retired=await root.commit(async tx=>ensureDailySchedule(tx,DailySchedule,Date.now(),(await store.read()).review),ctx);
  if(retired)await harness.abortTask(retired,ctx);
  harness.resume();
}
await syncDailySchedule();

const site=fileURLToPath(new URL('../web/',import.meta.url));
const assets:Record<string,string>={'/':'index.html','/assets/style.css':'style.css','/assets/app.js':'app.js',
  '/assets/locale.js':'locale.js','/assets/reviews.js':'reviews.js','/assets/settings.js':'settings.js'};
const mime:Record<string,string>={html:'text/html',css:'text/css',js:'text/javascript'};
const snapshot=async()=>((await harness.snapshot(Runs,root.id,ctx))?.runs||{}) as Record<string,any>;
const send=(res:any,status:number,result:any)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));};
function parseRunBody(text:string){
  // Pi persists JSON. Keep large integer query bounds as decimal strings so a
  // read, retry or handoff to Python cannot round away a nanosecond.
  const bounds:[Record<string,unknown>,string,string][]=[];
  const raw=JSON.parse(text,function(key,value,context){
    if((key==='start'||key==='end')&&typeof value==='number'&&!Number.isSafeInteger(value)&&/^-?\d+$/.test(context.source))
      bounds.push([this,key,context.source]);
    return value;
  });
  for(const [owner,key,literal] of bounds){
    if(owner===raw||owner===raw?.data)owner[key]=literal;
  }
  return raw;
}
async function body(req:any,kind?:'report'|'settings'|'run'){
  const limit=kind==='report'?32*1024*1024:kind==='settings'||kind==='run'?1024*1024:16000;
  let data='',size=0;
  req.setEncoding('utf8');
  for await(const chunk of req.iterator({destroyOnReturn:false})){
    size+=Buffer.byteLength(chunk);
    if(size>limit){req.resume();throw Error(kind==='report'?'PERFORMANCE_REPORT_TOO_LARGE':kind==='run'?'RESEARCH_REQUEST_TOO_LARGE':'BAD_REQUEST');}
    data+=chunk;
  }
  try{return kind==='run'?parseRunBody(data):JSON.parse(data);}catch{throw new Error('BAD_REQUEST');}
}
async function availableModels(){return (await models.getAvailable()).map(modelView);}
async function modelConversation(tx:Tx,settings:ModelChoice){
  const conversation=await tx.createConversation({ownership:{kind:'ownerless'}});
  await configure(tx,conversation.id,{model:{provider:settings.provider,modelId:settings.model},thinkingLevel:settings.thinking,maxTurns:1,tools:[]});
  await setModelSpeed(tx,conversation.id,settings.speed);
  return conversation;
}
async function reviewModel(){
  const defaults=await modelPrefs.defaults();
  if(!defaults)throw Error('MODEL_REQUIRED');
  if(!await models.checkAuth(defaults.provider))throw Error('MODEL_CREDENTIAL');
  return choice(defaults,await availableModels());
}

type ReviewInput=ReturnType<typeof reviewRequest> & {trigger?:'daily';period?:{date:string;start:string;end:string}};
async function startReview(tx:Tx,input:ReviewInput,mode:'paper'|'live',modelSettings:ModelChoice){
  const {reviews}=await tx.doc(Reviews);
  const prior=reviews[input.id];
  if(prior)return (prior.trigger??'manual')===(input.trigger??'manual')&&sameReviewRequest(prior,input);
  const conversation=await modelConversation(tx,modelSettings);
  const task=await tx.createTask(PerformanceReview,input,{ownership:{kind:'conversation'},conversationId:conversation.id});
  reviews[input.id]={...input,mode,modelSettings,task,created:new Date().toISOString(),status:'diagnosing'};
  return true;
}
async function settingsView({model,nautilus:{strategyToken,...nautilus},review,data:{agentToken,...data}}:Settings){
  return {writable:true,model:{connected:model.openai?.type==='api_key',chatGPTConnected:model['openai-codex']?.type==='oauth',
    chatGPT:chatGPT.view(),defaults:model.defaults??null,models:await availableModels()},
    nautilus:{...nautilus,strategyTokenConfigured:Boolean(strategyToken)},review,data:{...data,agentTokenConfigured:Boolean(agentToken)}};
}
async function input(raw:any){
  if(!raw||!['paper','minute'].includes(raw.preset))throw new Error('BAD_REQUEST');
  const timestamp=(value:unknown)=>typeof value==='string'?value.trim().length>0:Number.isSafeInteger(value);
  if(!timestamp(raw.start)||!timestamp(raw.end))throw new Error('INVALID_DATES');
  const horizon=Number(raw.horizon),seed=Number(raw.seed);
  if(!Number.isSafeInteger(horizon)||horizon<1||!Number.isSafeInteger(seed))throw new Error('BAD_REQUEST');
  const {model:{defaults},data:{catalog}}=await store.read();
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
  const researchInput={start:raw.start,end:raw.end,horizon,seed,direction:researchDirection(raw.direction),
    data:raw.data??{data_cls:'nautilus_trader.model.data:Bar'},
    ...(raw.instrumentField===undefined?{}:{instrumentField:raw.instrumentField}),
    ...(raw.targetField===undefined?{}:{targetField:raw.targetField})};
  return {preset:raw.preset,catalog,...selected,researchInput,rules};
}
// A connection published on the Docker host's loopback can arrive from its bridge gateway.
const routes=container?await readFile('/proc/net/route','utf8').catch(()=>''):'';
const gatewayHex=routes.split('\n').map(line=>line.trim().split(/\s+/)).find(([,destination])=>destination==='00000000')?.[2];
const gateway=gatewayHex&&[...Buffer.from(gatewayHex,'hex')].reverse().join('.');
const server=createServer(async (req,res)=>{
  try{
    const url=new URL(req.url||'/', 'http://localhost');
    const path=url.pathname;
    const method=req.method;
    const local=localSettingsRequest(req.headers.host,req.socket,gateway);
    if(method==='GET'&&Object.hasOwn(assets,path)){
      const name=assets[path];res.writeHead(200,{'Content-Type':mime[name.split('.').at(-1)!]+';charset=utf-8','Cache-Control':'private, no-cache','Content-Security-Policy':"default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(await readFile(join(site,name)));return;
    }
    if(method==='POST'&&(path==='/api/runs'||path==='/api/performance'||/^\/api\/runs\/[0-9a-f-]{36}\/(actions|strategies)$/.test(path))){
      const isStrategy=path.endsWith('/strategies')||path==='/api/performance';
      const problem=agentWriteError({origin:req.headers.origin,browser:req.headers['sec-fetch-site'],
        authorization:req.headers.authorization,localHost:isStrategy||local},
        isStrategy?undefined:(await store.read()).data.agentToken);
      if(problem)return send(res,problem==='WEB_READ_ONLY'?403:401,{error:problem});
    }
    const origin=req.headers.origin;
    if(method==='POST'&&((origin!==undefined&&(!URL.canParse(origin)||new URL(origin).host!==req.headers.host))||
       !req.headers['content-type']?.startsWith('application/json')))return send(res,403,{error:'BAD_REQUEST'});
    if(path==='/api/performance'&&method==='POST'){
      if(!authorizedStrategyWrite(req.headers.authorization,(await nautilusSettings()).strategyToken))return send(res,401,{error:'STRATEGY_AUTH_REQUIRED'});
      const report=performanceReport(await body(req,'report'));
      const status=await root.commit(tx=>importPerformance(tx,report),ctx);
      return send(res,status,status===409?{error:'PERFORMANCE_ID_CONFLICT'}:{id:report.id});
    }
    if(path==='/api/performance'&&method==='GET'){
      const index=await harness.snapshot(PerformanceIndex,ctx);
      const reports=Object.values(index?.reports??{}).sort((a,b)=>Date.parse(b.asOf)-Date.parse(a.asOf));
      return send(res,200,{reports});
    }
    if(path==='/api/performance/reviews'&&method==='POST'){
      const {nautilus,review}=await store.read();
      if(req.headers.origin||req.headers['sec-fetch-site']){
        if(!req.headers.origin||!local)return send(res,403,{error:'WEB_READ_ONLY'});
      }else if(!authorizedStrategyWrite(req.headers.authorization,nautilus.strategyToken))return send(res,401,{error:'STRATEGY_AUTH_REQUIRED'});
      const raw=await body(req);
      const prior=(await harness.snapshot(Reviews,ctx))?.reviews[raw?.id];
      const input=reviewRequest(raw,prior??review);
      const {id,reportIds}=input;
      const reply=(ok:boolean)=>send(res,ok?202:409,ok?{id}:{error:'REVIEW_ID_CONFLICT'});
      if(prior)return reply(prior.trigger!=='daily'&&sameReviewRequest(prior,input));
      const reports=(await harness.snapshot(PerformanceIndex,ctx))?.reports??{};
      const selected=reportIds.map((key:string)=>reports[key]);
      if(selected.some(r=>!r))return send(res,404,{error:'NOT_FOUND'});
      const mode=selected[0].mode;
      const modelSettings=await reviewModel();
      const admitted=await root.commit(tx=>startReview(tx,input,mode,modelSettings),ctx);
      harness.resume();
      return reply(admitted);
    }
    if(path==='/api/performance/reviews'&&method==='GET'){
      const reportId=url.searchParams.get('reportId');
      if(reportId!==null&&!strategyId.test(reportId))return send(res,400,{error:'BAD_REQUEST'});
      const mode=url.searchParams.get('mode');
      if(mode!==null&&mode!=='paper'&&mode!=='live')return send(res,400,{error:'BAD_REQUEST'});
      const records=Object.values((await harness.snapshot(Reviews,ctx))?.reviews??{}) as Array<{
        id:string;status:string;created:string;reportIds:string[];objective:string;mode:string;
        trigger?:'daily';period?:ReviewInput['period'];
      }>;
      const reviews=records.filter(r=>{
        if(r.trigger==='daily'&&mode)return r.mode===mode;
        return reportId?r.reportIds.includes(reportId):!mode||r.mode===mode;
      }).map(({id,status,created,reportIds,objective,mode,trigger,period})=>({id,status,created,reportIds,objective,mode,trigger:trigger??'manual',period}))
        .sort((a,b)=>b.created.localeCompare(a.created));
      const schedule=await harness.snapshot(DailyScheduleState,ctx);
      const daily=schedule&&{enabled:Boolean(schedule.task),time:schedule.settings?.time,
        nextAt:schedule.nextAt,nextCheckAt:schedule.nextCheckAt,lastDate:schedule.lastDate,modes:schedule.modes};
      return send(res,200,{reviews,daily,writable:local});
    }
    if(method==='GET'&&path.startsWith('/api/performance/reviews/')){
      const id=path.slice('/api/performance/reviews/'.length);
      const record=strategyId.test(id)&&(await harness.snapshot(Reviews,ctx))?.reviews[id];
      if(!record)return send(res,404,{error:'NOT_FOUND'});
      const context=await harness.snapshot(ReviewInputs,id,ctx);
      return send(res,200,{...record,context:context??null});
    }
    if(method==='GET'&&path.startsWith('/api/performance/')){
      const id=path.slice('/api/performance/'.length);
      const report=strategyId.test(id)?await harness.snapshot(PerformanceReport,id,ctx):undefined;
      return report?send(res,200,report):send(res,404,{error:'NOT_FOUND'});
    }
    if(path==='/api/strategy-targets'&&method==='GET'){
      const {targets,strategyToken}=await nautilusSettings();
      return send(res,200,{targets:targets.map(({id,label,roles})=>({id,label,roles})),enabled:Boolean(strategyToken)});
    }
    if(path==='/api/models'&&method==='GET')return send(res,200,{models:await availableModels()});
    const section=path.match(/^\/api\/settings\/(model|nautilus|review|data)$/)?.[1];
    if((path==='/api/settings'&&method==='GET')||(section&&method==='POST')){
      const saved=await store.read();
      const writable=local||await cloudflareSettingsAccess(req.headers['cf-access-jwt-assertion'],saved.data);
      if(!section)return send(res,200,writable?await settingsView(saved):{writable:false});
      if(!writable||(!origin&&req.headers['sec-fetch-site'])||(!local&&origin&&origin!=='https://'+req.headers.host))
        return send(res,403,{error:'SETTINGS_ACCESS'});
      const raw=await body(req,'settings');
      if(section!=='model'){
        await store.edit(s=>applySettings(s,section,raw));
        if(section==='review')await syncDailySchedule();
        return send(res,200,await settingsView(await store.read()));
      }
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
      return send(res,200,await settingsView(await store.read()));
    }
    if(path==='/api/runs'&&method==='GET'){
      const runs=await snapshot();
      return send(res,200,Object.values(runs).map(({id,preset,status,created,current,progress,input})=>({id,preset,status,created,current,progress,direction:input?.direction??''})).reverse());
    }
    if(path==='/api/runs'&&method==='POST'){
      const raw=await body(req,'run');
      const id=raw?.id;
      if(typeof id!=='string'||!strategyId.test(id))throw new Error('BAD_REQUEST');
      const admission=runAdmission(raw);
      const prior=(await snapshot())[id];
      if(prior)return sameRunAdmission(prior.admission,admission)?send(res,202,{id}):send(res,409,{error:'RUN_ID_CONFLICT'});
      const config=await input(admission);
      const admitted=await root.commit(async tx=>{
        const runs=(await tx.doc(Runs,root.id)).runs;
        if(runs[id])return sameRunAdmission(runs[id].admission,admission);
        const conversation=await modelConversation(tx,config);
        // The run owns Agent work in a separate configured conversation; records
        // are surfaced via the root Pi document using that address in the input.
        const {researchInput,...settings}=config;
        const task=await tx.createTask(Run,{...settings,...researchInput,id,docId:root.id},{ownership:{kind:'conversation'},conversationId:conversation.id});
        runs[id]={id,task,admission,preset:config.preset,provider:config.provider,model:config.model,thinking:config.thinking,speed:config.speed,input:researchInput,status:'queued',created:new Date().toISOString(),generations:[],current:0,limit:config.rules.generations};
        return true;
      },ctx);
      if(!admitted)return send(res,409,{error:'RUN_ID_CONFLICT'});
      harness.resume();
      return send(res,202,{id});
    }
    const m=path.match(/^\/api\/runs\/([0-9a-f-]{36})(?:\/(events|actions|export|strategies))?$/);
    if(m){
      const [,id,action]=m;
      const run=(await snapshot())[id];
      if(!run)return send(res,404,{error:'NOT_FOUND'});
      if(!action&&method==='GET'){
        const {admission,...report}=run;return send(res,200,report);
      }
      if(action==='strategies'&&method==='POST'){
        const {targets,strategyToken}=await nautilusSettings();
        if(!authorizedStrategyWrite(req.headers.authorization,strategyToken))return send(res,401,{error:'STRATEGY_AUTH_REQUIRED'});
        const raw=await body(req);
        if(typeof raw?.id!=='string'||!strategyId.test(raw.id)||typeof raw.target!=='string'||!['build','push'].includes(raw.action))
          return send(res,400,{error:'BAD_REQUEST'});
        const selectedTarget=targets.find(x=>x.id===raw.target);
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
          const window=strategyWindow(run,raw);
          if(!window)return send(res,400,{error:'STRATEGY_BACKTEST_DATES'});
          const {start,end,researchEnd}=window;
          const result=await root.commit(async tx=>{
            const r=(await tx.doc(Runs,root.id)).runs[id];
            r.strategies??={};
            const existing=r.strategies[raw.id];
            if(existing)return existing.target===raw.target&&existing.start===start&&existing.end===end&&existing.brief===brief;
            const conversation=await modelConversation(tx,tracked);
            const task=await tx.createTask(StrategyBuild,{docId:root.id,runId:id,id:raw.id,target:raw.target,start,end,researchEnd,evidence,brief,marketContext:selectedTarget.marketContext??'',
              researchContext:{...r.input,...(r.coverage?.columns&&{featureColumns:r.coverage.columns}),
                ...(r.coverage?.targetField&&{targetField:r.coverage.targetField})},modelSettings:tracked},
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
    if(['PERFORMANCE_REPORT_TOO_LARGE','RESEARCH_REQUEST_TOO_LARGE'].includes(e.message))return send(res,413,{error:e.message});
    const known=['BAD_REQUEST','INVALID_DATES','MODEL_REQUIRED','MODEL_UNKNOWN','THINKING_UNSUPPORTED','SPEED_UNSUPPORTED','MODEL_KEY_INVALID','MODEL_CONNECTION_FAILED','MODEL_CREDENTIAL','STRATEGY_TARGET_CONFIG','INVALID_RESEARCH_DIRECTION','INVALID_PERFORMANCE_REPORT'];
    if(!known.includes(e.message))console.error(e);
    if(!res.headersSent)send(res,known.includes(e.message)?400:500,{error:known.includes(e.message)?e.message:'SERVER_ERROR'});
    else res.end();
  }
});
server.listen(startup.port,startup.host);
for(const sig of ['SIGINT','SIGTERM'])process.once(sig,async ()=>{server.close();server.closeAllConnections();await harness.close(ctx);process.exit(0);});
