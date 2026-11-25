import {AssistantEntry, GenerationTask, hook, configure, defineDoc, defineExtension, defineSignal, defineTask} from '@earendil-works/pi-durable';
import {obj, str} from '@earendil-works/pi-schema';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {metrics, modes, roles, rng, select, shuffle, type Candidate, paper} from './method.ts';
import {providerSpeed,type ServiceTier} from './model-settings.ts';
import {isDeepStrictEqual} from 'node:util';
import {callTarget,planInstructions,validateStrategyPlan} from './strategy.ts';
import {researchPromptContext} from './research-context.ts';

export const Runs=defineDoc<any>({kind:'alpha.runs',version:1,scope:'conversation',history:'latest',fork:'initial',initial:()=>({runs:{}}),checkpointWhen:()=>true});
const Calls=defineDoc<any>({kind:'alpha.calls',version:1,scope:'task',history:'latest',initial:()=>({byKey:{}}),checkpointWhen:()=>true});
const Request=defineDoc<any>({kind:'alpha.request',version:1,scope:'conversation',history:'latest',fork:'initial',initial:()=>({}),checkpointWhen:()=>true});
export async function setModelSpeed(tx:any,id:any,speed:ServiceTier|null){
  const request=await tx.doc(Request,id);
  request.speed=speed;
}
export const Resume=defineSignal({name:'alpha.resume',version:1,schema:obj({action:str()})});
const owner=(api:any)=>({ownership:{kind:'task' as const,taskId:api.taskId}});
const next=(checkpoint:any)=>({status:'pending' as const,checkpoint});
const done=(result:any)=>({status:'terminal' as const,outcome:{status:'completed' as const,result}});
const abort=(_t:any,a:any,c:any)=>a.commit(()=>({status:'terminal',outcome:{status:'aborted'}}),c);
export type Driver = {
  keys:readonly string[];
  contract:string;
  prepare:(config:any,signal:AbortSignal)=>Promise<unknown>;
  score:(code:string,config:any,signal:AbortSignal)=>Promise<any>;
};
const internalSkill=new URL('../skills/cogalpha/SKILL.md', import.meta.url);
const strategySkill=new URL('../skills/strategy/SKILL.md',import.meta.url);
const bridge=fileURLToPath(new URL('../quant/bridge.py',import.meta.url));
function python(phase:string,config:any,body:any,signal:AbortSignal) {
  return new Promise<any>((resolve,reject)=>{
    const proc=spawn(process.env.ALPHA_PYTHON||'python3',[bridge,phase,join(process.env.ALPHA_STATE||'state',config.id)],{
      signal,env:{PATH:process.env.PATH,LANG:'C.UTF-8',OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1'},stdio:['pipe','pipe','pipe']});
    let out='', err='';
    proc.stdout.on('data',d=>{out+=d;});
    proc.stderr.on('data',d=>{err=(err+d).slice(-8192);});
    proc.stdin.on('error',()=>{});
    proc.on('error',reject);
    proc.on('close',n=>{if(n!==0){reject(new Error(err.includes('SANDBOX_UNAVAILABLE')?'SANDBOX_UNAVAILABLE':err.includes('NO_BARS')?'NO_BARS':'QUANT_WORKER_FAILED'));return;}try{resolve(JSON.parse(out));}catch(e){reject(e);}});
    proc.stdin.end(JSON.stringify(body));
  });
}
export const nautilus:Driver={
  keys:metrics,contract:'Return a complete Python function factor(df) -> pandas Series aligned to the input MultiIndex (ts, instrument). ts is UTC availability in integer nanoseconds. Only open, high, low, close and volume exist. Use only current and prior rows. Respect time gaps; do not hardcode instruments or use BTC movement as a market-wide signal. No network or file I/O. Do not implement orders or use future returns in factor().',
  prepare:(c,s)=>python('prepare',c,c,s),
  score:(code,c,s)=>python('score',c,{code,nanLimit:c.rules.nanLimit},s)
};
class WorkflowError extends Error {}
type Ask=(api:any,ctx:any,id:string,prompt:string,sampling?:number)=>Promise<string>;
const piAsk:Ask=async (api,ctx,id,prompt,sampling)=>{
  const skill=(await readFile(id==='strategy:plan'?strategySkill:internalSkill,'utf8')).replace(/^---[\s\S]*?---\s*/, '').trim();
  let cid;
  const parentRequest=await api.snapshot(Request,api.conversationId,ctx);
  await api.commit(async (tx:any)=>{
    const calls=await tx.doc(Calls,api.taskId);
    if(calls.byKey[id]){cid=calls.byKey[id];return;}
    const child=await tx.createConversation(owner(api));
    await configure(tx,child.id,{instructions:skill,tools:[],maxTurns:1});
    calls.byKey[id]=child.id;
    const request=await tx.doc(Request,child.id);
    request.maxTokens=id==='strategy:plan'?16000:4096;
    request.temperature=sampling??null;
    request.speed=parentRequest?.speed??null;
    cid=child.id;
  },ctx);
  const conversation=await api.conversation(cid,ctx);
  const s=await (await conversation.submit({type:'input',content:prompt,requestId:id},ctx)).wait(ctx);
  if(s.status!=='done'||s.type!=='input')throw new WorkflowError('MODEL_UNANSWERED');
  let e; await api.commit(async (tx:any)=>{e=await tx.entry(AssistantEntry,s.answer);},ctx);
  const answer=e?.model?.[0]?.content?.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('').trim();
  if(!answer)throw new WorkflowError('MODEL_EMPTY');
  return answer;
};
function json(text:string) {
  try{return JSON.parse(text.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,''));}
  catch {throw new WorkflowError('MODEL_FORMAT');}
}
const revision=(v:any,stage:string)=>{
  if(!v||!['name','hypothesis','formula','code'].every(k=>typeof v[k]==='string'&&v[k].trim()))throw new WorkflowError('MODEL_FORMAT');
  return {stage,name:v.name,hypothesis:v.hypothesis,formula:v.formula,code:v.code};
};
const revSchema='Return JSON with nonempty string fields name, hypothesis, formula, code.';
function generationPlan(c:any,g:number,parents:Candidate[],feedback:any) {
  const random=rng(c.seed+g*7919);
  const active=shuffle(roles,rng(c.seed)).slice(0,13);
  const count=g===0?c.rules.initial:parents.length?c.rules.children:c.rules.initial;
  const hasInjection=g>0&&parents.length>0&&g%c.rules.injectEvery===0;
  return Array.from({length:count+(hasInjection?c.rules.inject:0)},(_,i)=>{
    const p=parents[i%parents.length];
    const second=parents.length>1?parents[(i%parents.length+1+Math.floor(random()*(parents.length-1)))%parents.length]:undefined;
    const operation=(!p||i>=count)?(g===0?'seed':'inject'):second?['mutation','crossover','crossover_mutation'][i%3]:'mutation';
    const ancestors=operation==='mutation'?[p]:operation.startsWith('crossover')?[p,second]:[];
    return {id:`${g}.${i}`,sampling:(7+Math.floor(random()*6))/10,role:active[i%active.length],mode:modes[Math.floor(random()*modes.length)],operation,ancestors,feedback,config:c};
  });
}
export function createCogAlpha(driver:Driver=nautilus,ask:Ask=piAsk){
  const CandidateTask=defineTask<any,any,any>({
    name:'alphazonai.candidate',version:1,initial:()=>({phase:'evaluate'}),
    phases:{evaluate:async (task,api,ctx)=>{
      const {id,role,mode,operation,ancestors,feedback,config,sampling}=task.input;
      const row:Candidate={id,parents:ancestors.map((x:Candidate)=>x.id),role:role.name,mode,operation,reviews:[],revisions:[]};
      const base=`${driver.contract}\n${revSchema}`;
      const askCandidate=(key:string,prompt:string,temperature?:number)=>
        ask(api,ctx,`${id}:${key}`,researchPromptContext(config)+'\n'+prompt,temperature);
      const draft=async (stage:string,text:string)=>{
        const result=revision(json(await askCandidate(stage,`${base}\n${text}`,stage.includes("repair")||stage.includes("improvement")?0.8:sampling)),stage);
        row.revisions.push(result);
        return result;
      };
      const review=async (stage:string,r:any,prompt:string)=>{
        const v=json(await askCandidate(stage,`${driver.contract}\n${prompt}\nReturn JSON { "pass": boolean, "reason": string }.\nCandidate: ${JSON.stringify(r)}`,0.8));
        if(typeof v?.pass!=='boolean'||typeof v?.reason!=='string')throw new WorkflowError('MODEL_FORMAT');
        row.reviews.push({stage,pass:v.pass,reason:v.reason});
        return v;
      };
      const check=async (r:any,tag:string)=>{
        for(let n=0;n<=config.rules.repairs;n++){
          const quality=await review(`${tag}:code_quality:${n}`,r,'Code Quality: review syntax, input contract, indexing, and runtime behavior.');
          if(!quality.pass){
            if(n===config.rules.repairs) return {failure:'CODE_QUALITY'};
            r=await draft(`${tag}:code_repair:${n}`,`Code Repair: fix this defect, preserving the hypothesis. ${JSON.stringify({r,quality})}`);
            continue;
          }
          const logic=await review(`${tag}:judge:${n}`,r,'Judge: verify alignment between code, hypothesis and formula; reject circular or unjustified mechanisms.');
          if(!logic.pass){
            if(n===config.rules.repairs) return {failure:'LOGIC'};
            r=await draft(`${tag}:logic_improvement:${n}`,`Logic Improvement: address the research flaw. ${JSON.stringify({r,logic})}`);
            continue;
          }
          let result;
          try{result=await driver.score(r.code,config,api.signal);}
          catch(e:any){if(api.signal.aborted)throw e; return {failure:e.message==='SANDBOX_UNAVAILABLE'?'SANDBOX_UNAVAILABLE':'EVALUATION_FAILED'};}
          if(!result.failure || ['SANDBOX_UNAVAILABLE','INSUFFICIENT_CROSS_SECTIONS'].includes(result.failure) || n===config.rules.repairs)return result;
          r=await draft(`${tag}:runtime_repair:${n}`,`Code Repair: fix the observed deterministic failure, preserving the hypothesis. ${JSON.stringify({r,result})}`);
        }
        return {failure:'EVALUATION_FAILED'};
      };
      try {
        const last=ancestors.map((x:Candidate)=>x.revisions.at(-1));
        let r;
        if(operation.startsWith('crossover')){
          r=await draft('crossover',`Cross over complementary mechanisms from these two programs: ${JSON.stringify(last)}. Feedback: ${JSON.stringify(feedback)}`);
          const checked=await check(r,'crossover');
          if(operation==='crossover'||checked.failure){Object.assign(row,checked);return await api.commit(()=>done(row),ctx);}
          r=await draft('mutation',`Mutate the checked crossover without discarding both inherited mechanisms. ${JSON.stringify(row.revisions.at(-1))}`);
        } else if(operation==='mutation'){
          r=await draft('mutation',`Mutate this parent. Make a specific meaningful change. ${JSON.stringify({parent:last[0],feedback})}`);
        } else {
          const guide=await askCandidate('guidance',`Rewrite the role guidance in the requested style for this task. Return JSON {"guidance":string}. ${role.guide} ${mode}\n${driver.contract}`,sampling);
          const guidance=json(guide)?.guidance;
          if(typeof guidance!=='string')throw new WorkflowError('MODEL_FORMAT');
          r=await draft('generation',`Research role ${role.name} (tier ${role.tier}). ${guidance}. Use development feedback, when available: ${JSON.stringify(feedback)}`);
        }
        Object.assign(row,await check(r,'final'));
      } catch(e:any){
        if(api.signal.aborted)throw e;
        if(!(e instanceof WorkflowError))api.report(e);
        row.failure=e instanceof WorkflowError?e.message:'CANDIDATE_FAILED';
      }
      await api.commit(()=>done(row),ctx);
    }},abort
  });
  const Gen=defineTask<any,any,any>({
    name:'alphazonai.generation',version:1,
    initial:()=>({phase:'dispatch',offset:0,rows:[]}),abort,
    phases:{
      dispatch:async (task,api,ctx)=>api.commit(async tx=>{
        const {offset,rows}=task.state.checkpoint;
        const batch=task.input.plan.slice(offset,offset+task.input.parallel);
        if(!batch.length)return done(rows);
        const ids=[];
        for(const item of batch)ids.push(await tx.createTask(CandidateTask,item,owner(api)));
        return {status:'waiting',checkpoint:{phase:'read',offset,rows,ids},on:ids,policy:'allSettled'};
      },ctx),
      read:async (task,api,ctx)=>{
        const {offset,rows,ids}=task.state.checkpoint;
        const outcomes=await api.outcomes(ids,ctx);
        const items=outcomes.map((x:any,i:number)=>x.status==='completed'?x.result:{
          id:task.input.plan[offset+i].id,parents:[],revisions:[],reviews:[],failure:'CANDIDATE_INTERRUPTED'
        });
        return api.commit(async tx=>{
          const run=(await tx.doc(Runs,(task.input.docId||api.conversationId))).runs[task.input.id];
          run.progress={completed:offset+items.length,total:task.input.plan.length};
          return next({phase:'dispatch',offset:offset+items.length,rows:[...rows,...items]});
        },ctx);
      }
    }
  });
  const Run=defineTask<any,any,any>({
    name:'alphazonai.run',version:1,initial:()=>({phase:'prepare'}),
    abort:async(task,api,ctx)=>api.commit(async tx=>{
      (await tx.doc(Runs,(task.input.docId||api.conversationId))).runs[task.input.id].status='stopped';
      return {status:'terminal',outcome:{status:'aborted'}};
    },ctx),
    phases:{
      prepare:async(task,api,ctx)=>{
        let coverage, error;
        try {coverage=await driver.prepare(task.input,api.signal);}
        catch(e:any) {if(api.signal.aborted)throw e; error=e.message;}
        return api.commit(async tx=>{
          const r=(await tx.doc(Runs,(task.input.docId||api.conversationId))).runs[task.input.id];
          if(error){r.status='failed';r.error=error;return done(null);}
          r.coverage=coverage??null;
          return next({phase:'boundary',g:0,parents:[],elite:[],feedback:null,history:[]});
        },ctx);
      },
      boundary:async(task,api,ctx)=>api.commit(async tx=>{
        const st=task.state.checkpoint, r=(await tx.doc(Runs,(task.input.docId||api.conversationId))).runs[task.input.id];
        if(r.pause){r.status='paused';r.waitingFor=st.g;return {status:'sleeping',checkpoint:st,signals:[Resume.key(`generation:${st.g}`)]};}
        const plan=generationPlan(task.input,st.g,st.parents,st.feedback);
        const id=await tx.createTask(Gen,{id:task.input.id,docId:task.input.docId||api.conversationId,plan,parallel:task.input.rules.parallel},owner(api));
        r.status='running';r.current=st.g;r.progress={completed:0,total:plan.length};
        return {status:'waiting',checkpoint:{...st,phase:'settle',child:id},on:[id],policy:'allSettled'};
      },ctx),
      settle:async(task,api,ctx)=>{
        const st=task.state.checkpoint, c=task.input;
        const [out]:any=await api.outcomes([st.child],ctx);
        if(out.status!=='completed')return api.commit(async tx=>{
          const r=(await tx.doc(Runs,(c.docId||api.conversationId))).runs[c.id];r.status='failed';r.error='GENERATION_FAILED';return done(null);
        },ctx);
        const rows:Candidate[]=out.result;
        const sel=select(rows,st.elite,c.rules,driver.keys);
        const rnd=rng(c.seed+st.g*65537);
        const example=(a:Candidate)=>({id:a.id,revision:a.revisions.at(-1)??null,failure:a.failure??null,scores:a.scores??null,reviews:a.reviews});
        const sample={positive:shuffle(sel.eligible,rnd).slice(0,2).map(example),negative:sel.negative.map(example)};
        let notes='';
        if(sample.positive.length||sample.negative.length){
          try{notes=await ask(api,ctx,`feedback:${st.g}`,`${researchPromptContext(c)}\nSummarize evidenced candidate successes and failures for future generation. Do not invent metrics. Return JSON {"summary":string}. ${JSON.stringify(sample)}`);}
          catch(e){if(api.signal.aborted)throw e;}
        }
        const history=[...st.history,sel.elites.length?sel.elites.reduce((v,a)=>v+(a.scores?.[driver.keys[0]]??0),0)/sel.elites.length:null];
        const w=c.rules.plateauWindow;
        const prev=history.slice(-2*w,-w),cur=history.slice(-w);
        const avg=(xs:number[])=>xs.reduce((s,v)=>s+v,0)/xs.length;
        const plateau=w>0&&prev.length===w&&cur.length===w&&[...prev,...cur].every(Number.isFinite)&&avg(cur)-avg(prev)<=c.rules.plateauDelta;
        const fatal=rows.length>0&&['SANDBOX_UNAVAILABLE','MODEL_UNANSWERED'].find(f=>rows.every(x=>x.failure===f));
        return api.commit(async tx=>{
          const r=(await tx.doc(Runs,(c.docId||api.conversationId))).runs[c.id];
          r.generations.push({index:st.g,subcycle:Math.floor(Math.max(0,st.g-1)/c.rules.subcycle),keys:driver.keys,rows,qualified:sel.qualified,elite:sel.elite,parents:sel.parents.map(x=>x.id),elites:sel.elites.map(x=>x.id),feedback:{sample,notes}});
          if(fatal){r.status='failed';r.error=fatal;return done(null);}
          if(st.g>=c.rules.generations||plateau){r.status='completed';r.stopReason=plateau?'plateau':'limit';return done(null);}
          return next({phase:'boundary',g:st.g+1,parents:sel.parents,elite:sel.elites,feedback:{sample,notes},history});
        },ctx);
      }
    }
  });
  const StrategyBuild=defineTask<any,any,any>({
    name:'alphazonai.strategy_build',version:1,initial:()=>({phase:'plan'}),
    abort:async(task,api,ctx)=>api.commit(async tx=>{
      const item=(await tx.doc(Runs,task.input.docId)).runs[task.input.runId].strategies[task.input.id];
      item.status='failed';item.error='STRATEGY_BUILD_FAILED';
      return {status:'terminal',outcome:{status:'aborted'}};
    },ctx),
    phases:{
      plan:async(task,api,ctx)=>{
        const input=task.input;
        try{
          const plan=validateStrategyPlan(json(await ask(api,ctx,'strategy:plan',planInstructions+'\nUser brief: '+input.brief+'\nOperator market context: '+input.marketContext+
            '\n'+researchPromptContext(input.researchContext??{barSpec:input.researchBarSpec})+'\nResearch evidence (JSON): '+JSON.stringify(input.evidence),0.8)));
          return api.commit(async tx=>{
            const item=(await tx.doc(Runs,input.docId)).runs[input.runId].strategies[input.id];
            item.status='backtesting';item.plan=plan;return next({phase:'backtest',plan});
          },ctx);
        }catch(e:any){
          if(api.signal.aborted)throw e;
          return api.commit(async tx=>{
            const item=(await tx.doc(Runs,input.docId)).runs[input.runId].strategies[input.id];
            item.status='failed';item.error=e instanceof WorkflowError?e.message:'STRATEGY_PLAN_INVALID';return done(null);
          },ctx);
        }
      },
      backtest:async(task,api,ctx)=>{
        const input=task.input, plan=task.state.checkpoint.plan;
        let receipt:any, problem:string|undefined;
        try{
          receipt=await callTarget(input.target,'backtest',
            {id:input.id,plan,start:input.start,end:input.end,research_end:input.researchEnd},api.signal);
          const module='alpha_strategy_'+input.id.replaceAll('-','');
          if(receipt.source!==plan.source||receipt.strategy.strategy_path!==module+':'+plan.strategyClass||
             receipt.strategy.config_path!==module+':'+plan.configClass||!isDeepStrictEqual(receipt.strategy.config,plan.config))
            throw Error('STRATEGY_RECEIPT_INVALID');
        }catch(e:any){if(api.signal.aborted)throw e;problem=e.message;}
        return api.commit(async tx=>{
          const item=(await tx.doc(Runs,input.docId)).runs[input.runId].strategies[input.id];
          if(problem){item.status='failed';item.error=problem;return done(null);}
          item.bundle={schema:2,plan,nautilus:receipt.nautilus,id:input.id,researchRun:input.runId,modelSettings:input.modelSettings,sourceCandidates:input.evidence.map((x:any)=>x.id),backtestTarget:input.target,strategy:receipt.strategy,backtest:receipt};
          item.status='validated';
          return done(null);
        },ctx);
      },
    },
  });
  const StrategyPush=defineTask<any,any,any>({
    name:'alphazonai.strategy_push',version:1,initial:()=>({phase:'stage'}),
    phases:{stage:async(task,api,ctx)=>{
      const input=task.input;
      let receipt:any,problem:string|undefined;
      try{receipt=await callTarget(input.target,'stage',{id:input.id,bundle:input.bundle},api.signal);}
      catch(e:any){if(api.signal.aborted)throw e;problem=e.message;}
      return api.commit(async tx=>{
        const op=(await tx.doc(Runs,input.docId)).runs[input.runId].strategies[input.id].deployments[input.target];
        if(problem){op.status='failed';op.error=problem;}else{op.status='staged';op.receipt=receipt;}
        return done(null);
      },ctx);
    }},
  });
  return {Run,StrategyBuild,StrategyPush,extension:defineExtension({name:'alphazonai',tasks:[Run,Gen,CandidateTask,StrategyBuild,StrategyPush],hooks:[hook(GenerationTask,{beforeProviderRequest:async (request,api,ctx)=>{
    const options=await api.snapshot(Request,api.conversationId,ctx);
    if(!options||!['openai-responses','openai-codex-responses'].includes(request.model.api)||!request.payload||typeof request.payload!=='object')return;
    const payload=providerSpeed({...request.payload,...(request.model.api==='openai-responses'&&options.maxTokens?{max_output_tokens:options.maxTokens}:{})},request.model,options.speed);
    // Reasoning endpoints do not uniformly accept temperature. Only apply it when
    // the active provider model declares explicit sampling support, or is non-reasoning.
    if(request.model.api==='openai-responses'&&options.temperature!=null&&(!request.model.reasoning||request.model.id.startsWith('gpt-oss-')))payload.temperature=options.temperature;
    return {payload};
  }})]})};
}
export const defaultRules=paper;
