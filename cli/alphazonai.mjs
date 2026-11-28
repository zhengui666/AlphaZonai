#!/usr/bin/env node
import {readFile, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';

const contract=1;
const defaults={url:'http://127.0.0.1:8787',timeout:10000};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const arg=(type,description,required=false)=>({type,description,required});
const id=arg('uuid','Existing research run UUID.',true);
const strategy=arg('uuid','Strategy UUID. Generate once with id and reuse.',true);
const reportId=arg('uuid','Performance report UUID.',true);
const review=arg('uuid','AI review UUID. Generate once with id and reuse.',true);
const target=arg('string','Exact configured target ID.',true);
const start=arg('date','UTC start date, inclusive (YYYY-MM-DD).',true);
const end=arg('date','UTC end date, exclusive (YYYY-MM-DD).',true);
const file=arg('file','Read UTF-8 from a file or use - for stdin.');
const output=arg('file','Write the raw artifact to a new file, without overwriting.');
const waiting={ 'wait-ms':arg('integer','Maximum wait in milliseconds (default 30000).'), 'interval-ms':arg('integer','Polling interval in milliseconds (default 1000).') };
const settingsFields={
  model:['action','key','provider','model','thinking','speed'],
  nautilus:['python','targets','strategyToken'],
  review:['enabled','time','language','objective'],
  data:['catalog','stateDir','host','port','agentToken','accessTeam','accessAud'],
};
const commands={
  id:{description:'Generate a request UUID locally.',options:{}},
  doctor:{description:'Inspect the advertised models, strategy targets and strategy-write availability.',options:{}},
  'settings get':{description:'Read settings locally or through Cloudflare Access.',method:'GET',path:'/api/settings',auth:'cloudflare-access',options:{}},
  'settings set':{description:'Update one settings section locally or through Cloudflare Access.',method:'POST',path:'/api/settings/:section',auth:'cloudflare-access',
    fields:settingsFields,modelActions:['connect','disconnect','chatgpt-start','chatgpt-cancel','chatgpt-disconnect','defaults'],
    options:{section:arg('string','model, nautilus, review or data.',true),file:arg('file','JSON object containing the fields to change. Use - for stdin.',true)}},
  'models list':{description:'List available provider model IDs and capabilities.',method:'GET',path:'/api/models',options:{}},
  'runs list':{description:'List research runs.',method:'GET',path:'/api/runs',options:{}},
  'runs start':{description:'Submit a new research run, or reconcile a retry with the same UUID and input.',method:'POST',path:'/api/runs',auth:'agent',options:{
    id:arg('uuid','Caller-generated UUID; keep it for retries.',true),
    start:arg('string','Inclusive research start as a Nautilus timestamp, e.g. a UTC date or ISO timestamp.',true),
    end:arg('string','Exclusive research end as a Nautilus timestamp.',true),
    horizon:arg('integer','Prediction horizon in minutes (default 5; not hold time).'),
    'data-file':arg('file','Native Nautilus catalog query as a JSON object. Use - for stdin.'),
    'instrument-field':arg('string','Source field identifying the instrument for each observation.'),
    'target-field':arg('string','Numeric source field for the forward-return label.'),
    seed:arg('integer','Research random seed (default 42).'),direction:arg('string','Optional research direction.'),
    'direction-file':file,provider:arg('string','Provider ID from models list.'),model:arg('string','Model ID from models list or omit to use saved defaults.'),
    thinking:arg('string','A supported thinking level from models list.'),speed:arg('string','A supported speed from models list; use default for Standard and priority for Fast.'),
    parallel:arg('integer','Candidate concurrency.'),generations:arg('integer','Maximum research generations.'),'plateau-window':arg('integer','Plateau window in generations.'),
  }},
  'runs get':{description:'Read the full run report.',method:'GET',path:'/api/runs/:id',options:{id}},
  'runs wait':{description:'Poll the run in the foreground until terminal; paused returns immediately.',method:'GET',path:'/api/runs/:id',options:{id,...waiting}},
  'runs pause':{description:'Request pause at a generation boundary; verify via runs get.',method:'POST',path:'/api/runs/:id/actions',auth:'agent',options:{id}},
  'runs resume':{description:'Resume an existing run; verify via runs get.',method:'POST',path:'/api/runs/:id/actions',auth:'agent',options:{id}},
  'runs stop':{description:'Request stop for an existing run. This does not stop trading.',method:'POST',path:'/api/runs/:id/actions',auth:'agent',options:{id}},
  'runs export':{description:'Export selected factor artifacts, not a backtest.',method:'GET',path:'/api/runs/:id/export',options:{id,output}},
  'strategies targets':{description:'List configured backtest and deployment targets and whether strategy writes are enabled.',method:'GET',path:'/api/strategy-targets',options:{}},
  'strategies build':{description:'Generate and backtest from a completed run with selected factors. Keep the strategy UUID on retries.',method:'POST',path:'/api/runs/:id/strategies',auth:'strategy',options:{id,strategy,target,start,end,brief:arg('string','Optional strategy brief.'),'brief-file':file}},
  'strategies get':{description:'Inspect a strategy build or one deployment receipt.',method:'GET',path:'/api/runs/:id',options:{id,strategy,target:{...target,required:false}}},
  'strategies wait':{description:'Poll a strategy build, or the deployment receipt for --target.',method:'GET',path:'/api/runs/:id',options:{id,strategy,target:{...target,required:false},...waiting}},
  'strategies export':{description:'Export a validated strategy package.',method:'GET',path:'/api/runs/:id/strategies?download=:strategy',options:{id,strategy,output}},
  'strategies push':{description:'Stage an inactive strategy package at the exact deployment target; never activates trading.',method:'POST',path:'/api/runs/:id/strategies',auth:'strategy',options:{id,strategy,target}},
  'performance import':{description:'Import a Nautilus paper or live performance report.',method:'POST',path:'/api/performance',auth:'strategy',options:{'report-file':{...file,required:true}}},
  'performance list':{description:'List imported performance reports.',method:'GET',path:'/api/performance',options:{}},
  'performance show':{description:'Read a performance report and its trades.',method:'GET',path:'/api/performance/:id',options:{id:reportId}},
  'performance review':{description:'Request an AI review of up to eight distinct paper or live reports.',method:'POST',path:'/api/performance/reviews',auth:'strategy',options:{
    id:reportId,with:arg('string','Additional report UUIDs, separated by commas.'),review,
    objective:arg('string','Review focus. Defaults to the objective in review settings.'),language:arg('string','zh-CN or en. Defaults to the language in review settings.'),
  }},
  'performance review-list':{description:'List AI performance review IDs and the daily schedule status.',method:'GET',path:'/api/performance/reviews',options:{}},
  'performance review-show':{description:'Read the status and findings of an AI performance review.',method:'GET',path:'/api/performance/reviews/:review',options:{review}},
};
const globalOptions={
  url:arg('url','Service origin (default '+defaults.url+').'),
  'token-file':arg('file','Cloudflare Access application JWT for settings, or the agent/strategy bearer token for writes. Use - for stdin.'),
  'timeout-ms':arg('integer','Per-request HTTP timeout in milliseconds (default 10000).'),
  'dry-run':arg('boolean','Preview a POST without making a request or sending credentials.'),
  pretty:arg('boolean','Indent the JSON response.'),
};
class CliError extends Error {
  constructor(code,message,exit=2,extra={}){
    super(message); this.code=code; this.exit=exit; this.extra=extra;
  }
}
const usage=(message)=>new CliError('USAGE',message);
const report=(json,pretty)=>JSON.stringify(json,null,pretty?2:0)+'\n';
function discovery(name){
  if(name&&!Object.hasOwn(commands,name))throw usage('Unknown command; run alphazonai schema.');
  return {contract,globalOptions,
    output:{success:'One JSON envelope on stdout; exit 0.',error:'One JSON envelope on stderr; stdout is empty.',admission:'HTTP 202 means accepted, not completed.'},
    ...(name?{command:name,...commands[name]}:{commands})};
}
function parse(argv){
  const params=[];
  const raw=Object.create(null);
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(!a.startsWith('--')){params.push(a);continue;}
    const split=a.indexOf('=');
    const k=split<0?a.slice(2):a.slice(2,split);
    if(Object.hasOwn(raw,k))throw usage('Duplicate option --'+k+'.');
    // Null-prototype map prevents option names overwriting object behavior.
    const flag=['dry-run','pretty','help','version'].includes(k);
    if(flag){if(split!==-1)throw usage('--'+k+' does not take a value.');raw[k]=true;}
    else{
      const v=split===-1?argv[++i]:a.slice(split+1);
      if(v===undefined||(split===-1&&v.startsWith('--')))throw usage('Missing value for --'+k+'.');
      Object.defineProperty(raw,k,{value:v,enumerable:true,writable:true});
    }
  }
  const selected=params.join(' ');
  const schema=params[0]==='schema'||raw.help||params[0]==='help'||!params.length;
  if(raw.version){
    if(params.length||Object.keys(raw).some(k=>!['version','pretty'].includes(k)))throw usage('--version only accepts --pretty.');
    return {name:'version',raw};
  }
  if(schema){
    if(Object.keys(raw).some(x=>!['help','pretty'].includes(x)))throw usage('Schema only accepts --pretty.');
    return {name:'schema',raw,selected:(params[0]==='schema'||params[0]==='help')?params.slice(1).join(' '):selected};
  }
  const spec=Object.hasOwn(commands,selected)&&commands[selected];
  if(!spec)throw usage('Unknown command; run alphazonai schema.');
  const opt={...globalOptions,...spec.options};
  for(const [k,v] of Object.entries(raw)){
    if(!Object.hasOwn(opt,k))throw usage('Unknown option --'+k+' for '+selected+'.');
    const type=opt[k].type;
    if(type==='uuid'&&!uuid.test(v))throw usage('--'+k+' must be a lower-case UUID.');
    if(type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))throw usage('--'+k+' must be a valid UTC date.');
    if(type==='integer'){
      const n=Number(v);
      if(!/^-?\d+$/.test(v)||!Number.isSafeInteger(n)||n<(k==='seed'?Number.MIN_SAFE_INTEGER:k==='plateau-window'?0:1))throw usage('--'+k+' must be a valid integer.');
      Object.defineProperty(raw,k,{value:n});
    }
    if((type==='string'||type==='file'||type==='url')&&!v.trim())throw usage('--'+k+' cannot be empty.');
    if(k.endsWith('-file')&&Object.hasOwn(raw,k.slice(0,-5)))throw usage('Choose one of --'+k+' and --'+k.slice(0,-5)+'.');
  }
  for(const [k,v] of Object.entries(spec.options))if(v.required&&!Object.hasOwn(raw,k))throw usage('Missing --'+k+'.');
  if(raw.section&&!Object.hasOwn(settingsFields,raw.section))throw usage('--section must be model, nautilus, review or data.');
  if(Object.keys(raw).filter(k=>opt[k].type==='file'&&k!=='output'&&raw[k]==='-').length>1)throw usage('Only one input file can use stdin.');
  if(selected==='strategies build'&&raw.start>=raw.end)throw usage('--end must be after --start.');
  if(raw['dry-run']&&spec.method!=='POST')throw usage('--dry-run applies only to write commands.');
  return {name:selected,raw,spec};
}
function baseUrl(raw,settingsWrite=false){
  let u;
  try{u=new URL(raw.url||defaults.url);}catch{throw usage('Invalid AlphaZonai service origin.');}
  const loopback=['127.0.0.1','localhost','[::1]'].includes(u.hostname);
  if(u.username||u.password||u.pathname!=='/'||u.search||u.hash||!(u.protocol==='https:'||(loopback&&u.protocol==='http:')))throw usage('Use an HTTPS origin, or HTTP only on loopback. URLs cannot contain credentials or a path.');
  if(settingsWrite&&!loopback&&!raw['token-file']&&!raw['dry-run'])throw usage('Remote settings updates require a Cloudflare Access application JWT via --token-file.');
  return u.origin;
}
async function readText(raw,k){
  const path=raw[k];
  if(path===undefined)return;
  try{
    if(path!=='-')return await readFile(path,'utf8');
    let s='';process.stdin.setEncoding('utf8');
    for await(const chunk of process.stdin)s+=chunk;
    return s;
  }catch{throw usage('Unable to read --'+k+'.');}
}
async function requestPlan(name,spec,raw){
  const url=baseUrl(raw,name==='settings set');
  const path=spec.path.replace(/:(id|strategy|review|section)/g,(_,key)=>encodeURIComponent(raw[key]));
  let body;
  if(name==='runs start'){
    if(raw.provider&&!raw.model)throw usage('--provider requires --model.');
    const direction=raw.direction??await readText(raw,'direction-file');
    body={id:raw.id,preset:'minute',start:raw.start,end:raw.end,horizon:raw.horizon??5,seed:raw.seed??42};
    if(raw['data-file']!==undefined){
      const contents=await readText(raw,'data-file');
      // Keep the original numeric literals when serializing native query arguments,
      // including nanosecond timestamps outside JavaScript's safe integer range.
      try{body.data=JSON.parse(contents,(_key,value,context)=>typeof value==='number'?JSON.rawJSON(context.source):value);}
      catch{throw usage('--data-file must contain valid JSON.');}
      if(!body.data||typeof body.data!=='object'||Array.isArray(body.data)||JSON.isRawJSON(body.data))throw usage('--data-file must contain a JSON object.');
    }
    if(raw['instrument-field']!==undefined)body.instrumentField=raw['instrument-field'];
    if(raw['target-field']!==undefined)body.targetField=raw['target-field'];
    if(direction!==undefined){
      if(direction.length>4000)throw usage('Research direction cannot exceed 4000 characters.');
      body.direction=direction;
    }
    for(const k of ['provider','model','thinking','speed','parallel','generations'])if(raw[k]!==undefined)body[k]=raw[k];
    if(raw['plateau-window']!==undefined)body.plateauWindow=raw['plateau-window'];
  }else if(name==='strategies build'){
    const brief=raw.brief??await readText(raw,'brief-file');
    if(brief!==undefined&&brief.length>2000)throw usage('Strategy brief cannot exceed 2000 characters.');
    body={action:'build',id:raw.strategy,target:raw.target,start:raw.start,end:raw.end,...(brief!==undefined?{brief}:{})};
  }else if(name==='strategies push'){
    body={action:'push',id:raw.strategy,target:raw.target};
  }else if(name==='performance import'||name==='settings set'){
    const flag=name==='settings set'?'file':'report-file';
    const contents=await readText(raw,flag);
    try{body=JSON.parse(contents);}catch{throw usage('--'+flag+' must contain valid JSON.');}
    if(name==='settings set'&&(!body||typeof body!=='object'||Array.isArray(body)||
      Object.keys(body).some(k=>!settingsFields[raw.section].includes(k))))throw usage('Expected a settings object with fields from alphazonai schema settings set.');
  }else if(name==='performance review'){
    const others=raw.with?raw.with.split(',').map(value=>value.trim()):[];
    if(others.some(value=>!uuid.test(value)))throw usage('--with must contain comma-separated report UUIDs.');
    if(raw.language&&!['zh-CN','en'].includes(raw.language))throw usage('--language must be zh-CN or en.');
    body={id:raw.review,reportIds:[raw.id,...others]};
    for(const key of ['objective','language'])if(raw[key]!==undefined)body[key]=raw[key];
  }else if(spec.method==='POST'){
    body={action:name.split(' ')[1]};
  }
  return {method:spec.method,url:url+path,body,auth:spec.auth,timeout:raw['timeout-ms']??defaults.timeout};
}
function recovery(name,raw,body){
  if(name==='settings set')return {command:'settings get'};
  if(name.startsWith('runs ')&&name!=='runs list')return {command:'runs get',id:raw.id};
  if(name.startsWith('strategies ')&&raw.strategy)return {command:'strategies get',id:raw.id,strategy:raw.strategy,...(raw.target&&name!=='strategies build'?{target:raw.target}:{})};
  if(name==='performance import'&&uuid.test(body?.id))return {command:'performance show',id:body.id};
  if(name==='performance review')return {command:'performance review-show',review:raw.review};
}
async function request(req,name,raw){
  const headers={Accept:'application/json'};
  if(req.body!==undefined)headers['Content-Type']='application/json';
  if(req.auth&&raw['token-file']){
    const token=(await readText(raw,'token-file')).trim();
    if(!token||/[\r\n]/.test(token))throw usage('--token-file must contain a single token.');
    if(req.auth==='cloudflare-access'){
      if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))throw usage('--token-file must contain a Cloudflare Access application JWT.');
      headers.Cookie='CF_Authorization='+token;
    }else headers.Authorization='Bearer '+token;
  }
  const write=req.method==='POST';
  const state=write?{outcome:'unknown',reconcile:recovery(name,raw,req.body)}:{};
  let response;
  try{
    response=await fetch(req.url,{method:req.method,headers,body:req.body===undefined?undefined:JSON.stringify(req.body),
      redirect:'error',signal:AbortSignal.timeout(Math.min(req.timeout,2**31-1))});
  }catch{
    throw new CliError('TRANSPORT','The request could not be confirmed.',4,state);
  }
  let data;
  try{data=await response.json();}
  catch{throw new CliError('INVALID_RESPONSE','The service did not return JSON.',4,{httpStatus:response.status,...state});}
  if(!response.ok){
    const e=typeof data?.error==='string'&&/^[A-Z][A-Z_0-9]{0,79}$/.test(data.error)?data.error:'HTTP_ERROR';
    const extra={httpStatus:response.status,...(response.status>=500?state:{})};
    if(response.status===401&&req.auth)extra.hint='Supply the configured '+req.auth+' token with --token-file.';
    throw new CliError(e,'AlphaZonai rejected the request.',3,extra);
  }
  return {data,status:response.status};
}
function strategySelection(run,raw){
  const entry=run?.strategies&&Object.hasOwn(run.strategies,raw.strategy)?run.strategies[raw.strategy]:undefined;
  if(!entry)throw new CliError('STRATEGY_NOT_FOUND','No strategy with this UUID was recorded for the run.',3);
  if(!raw.target)return entry;
  const delivery=entry.deployments&&Object.hasOwn(entry.deployments,raw.target)?entry.deployments[raw.target]:undefined;
  if(!delivery)throw new CliError('DEPLOYMENT_NOT_FOUND','No staging attempt was recorded for this target.',3);
  return delivery;
}
const terminal=(name,raw,status)=>name==='runs wait'?['completed','failed','stopped','paused'].includes(status):
  raw.target?['staged','failed'].includes(status):['validated','failed'].includes(status);
async function execute({name,raw,spec,selected}){
  if(name==='schema')return {data:discovery(selected),meta:{}};
  if(name==='version')return {data:{contract},meta:{}};
  if(name==='id')return {data:{id:randomUUID()},meta:{}};
  if(name==='doctor'){
    const origin=baseUrl(raw);
    const [models,targets]=await Promise.all(['/api/models','/api/strategy-targets'].map(path=>
      request({url:origin+path,method:'GET',timeout:raw['timeout-ms']??defaults.timeout},name,raw)));
    return {data:{origin,models:models.data.models,targets:targets.data.targets,strategyWritesEnabled:targets.data.enabled},meta:{}};
  }
  const req=await requestPlan(name,spec,raw);
  if(raw['dry-run']){
    const preview=name==='settings set'?{fields:Object.keys(req.body)}:{body:req.body};
    return {data:{method:req.method,url:req.url,...preview,auth:req.auth},meta:{dryRun:true}};
  }
  const wait=name.endsWith(' wait');
  const deadline=Date.now()+(raw['wait-ms']??30000);
  const interval=raw['interval-ms']??1000;
  while(true){
    const step=wait?{...req,timeout:Math.min(req.timeout,Math.max(1,deadline-Date.now()))}:req;
    const {data,status}=await request(step,name,raw);
    const result=['strategies get','strategies wait'].includes(name)?strategySelection(data,raw):data;
    if(!wait||terminal(name,raw,result?.status)){
      if(raw.output){
        try{await writeFile(raw.output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});}
        catch(e){
          if(e?.code==='EEXIST')throw new CliError('OUTPUT_EXISTS','The artifact output file already exists.',2);
          throw new CliError('OUTPUT_WRITE_FAILED','Could not write the artifact to the requested output file.',2);
        }
        return {data:{path:raw.output},meta:{httpStatus:status}};
      }
      return {data:result,meta:{httpStatus:status,...(status===202?{accepted:true,reconcile:recovery(name,raw)}:{})}};
    }
    const left=deadline-Date.now();
    if(left<=0)throw new CliError('WAIT_TIMEOUT','The operation has not reached a terminal state.',5,{lastStatus:result?.status,reconcile:recovery(name,raw)});
    await sleep(Math.min(left,interval));
    if(Date.now()>=deadline)throw new CliError('WAIT_TIMEOUT','The operation has not reached a terminal state.',5,{lastStatus:result?.status,reconcile:recovery(name,raw)});
  }
}
let pretty=process.argv.includes('--pretty');
try{
  const parsed=parse(process.argv.slice(2));
  pretty=parsed.raw.pretty??false;
  const result=await execute(parsed);
  process.stdout.write(report({ok:true,contract,...result},pretty));
}catch(error){
  const fail=error instanceof CliError?error:new CliError('CLI_ERROR','The command could not be completed.',1);
  process.stderr.write(report({ok:false,contract,error:{code:fail.code,message:fail.message,...fail.extra}},pretty));
  process.exitCode=fail.exit;
}
