import {randomUUID} from 'node:crypto';
import {defineDoc,defineTask,type TaskId,type Tx} from '@earendil-works/pi-durable';
import type {ModelChoice} from './model-settings.ts';
import type {ReviewSettings} from './settings.ts';
import {PerformanceIndex,PerformanceReport,type Report} from './performance.ts';
import {hasDailyActivity} from './review-analysis.ts';

const hour=3_600_000,day=24*hour,shanghai=8*hour;
const iso=(time:number)=>new Date(time).toISOString();
const modes=['paper','live'] as const;
type Mode=typeof modes[number];
type Outcome={status:'queued'|'no_data'|'no_activity'|'model_unavailable'|'error';reviewId?:string};
type State={task:TaskId|null;settings:ReviewSettings|null;nextAt:string|null;nextCheckAt:string|null;lastDate:string|null;modes:Partial<Record<Mode,Outcome>>};
export const DailyScheduleState=defineDoc<State>({
  kind:'alpha.performance.daily_schedule',version:1,scope:'session',
  initial:()=>({task:null,settings:null,nextAt:null,nextCheckAt:null,lastDate:null,modes:{}}),checkpointWhen:()=>true,
});

const localMidnight=(time:number)=>Math.floor((time+shanghai)/day)*day-shanghai;
function periodAt(due:number){
  const end=localMidnight(due),start=end-day;
  return {date:iso(start+shanghai).slice(0,10),start:iso(start),end:iso(end)};
}
type Input={id:string;trigger:'daily';reportIds:string[];objective:string;language:ReviewSettings['language'];period:ReturnType<typeof periodAt>};
type Dependencies={
  modelSettings:()=>Promise<ModelChoice|null>;
  startReview:(tx:Tx,input:Input,mode:Mode,model:ModelChoice)=>Promise<unknown>;
};

async function reportsForDay(mode:Mode,period:Input['period'],now:number,
  summaries:Pick<Report,'id'|'asOf'|'mode'|'coverageStart'>[],read:(id:string)=>Promise<Report|undefined>){
  const start=Date.parse(period.start),end=Date.parse(period.end);
  type Source={id:string;at:number};
  const scopes=new Map<string,{active:string[];parameters?:Source;closing?:Source}>();
  let hasClosingSnapshot=false;
  for(const summary of summaries){
    const at=Date.parse(summary.asOf),from=summary.coverageStart?Date.parse(summary.coverageStart):null;
    if(summary.mode!==mode||at<start||at>now||(from!==null&&from>=end))continue;
    const report=await read(summary.id);
    if(!report)continue;
    const key=JSON.stringify([report.accountId,report.strategyId]);
    if(!scopes.has(key))scopes.set(key,{active:[]});
    const scope=scopes.get(key)!;
    if(hasDailyActivity(report,period))scope.active.push(report.id);
    if(at<end&&Object.keys(report.parameters??{}).length&&(!scope.parameters||at>scope.parameters.at)){
      scope.parameters={id:report.id,at};
    }
    if(from!==null&&from<=start&&at>=end){
      hasClosingSnapshot=true;
      if(!scope.closing||at<scope.closing.at)scope.closing={id:report.id,at};
    }
  }
  const ids=new Set<string>();
  for(const scope of scopes.values()){
    if(!scope.active.length)continue;
    for(const id of scope.active)ids.add(id);
    if(scope.parameters)ids.add(scope.parameters.id);
    if(scope.closing)ids.add(scope.closing.id);
  }
  return {reportIds:[...ids],hasClosingSnapshot};
}

export function createDailySchedule({modelSettings,startReview}:Dependencies){
  const retired={status:'terminal',outcome:{status:'completed',result:null}} as const;
  return defineTask<{due:number},{phase:'run';due:number},null>({
    name:'alphazonai.daily_performance_review',version:1,initial:({due})=>({phase:'run',due}),
    phases:{run:async(task,api,ctx)=>{
      const {due}=task.state.checkpoint,now=api.now(),tomorrow=due+day;
      const previous=await api.snapshot(DailyScheduleState,ctx);
      if(previous?.task!==api.taskId)return api.commit(()=>retired,ctx);
      if(now<due)return api.sleepUntil(due,{phase:'run',due},ctx);
      const period=periodAt(due);
      const outcomes=previous.lastDate===period.date?{...previous.modes}:{};
      const index=await api.snapshot(PerformanceIndex,ctx);
      const summaries=Object.values(index?.reports??{});
      let settings:Promise<ModelChoice|null>|undefined;
      for(const mode of modes){
        if(outcomes[mode]?.status==='queued')continue;
        try{
          const {reportIds,hasClosingSnapshot}=await reportsForDay(mode,period,now,summaries,id=>api.snapshot(PerformanceReport,id,ctx));
          if(!reportIds.length){
            outcomes[mode]={status:hasClosingSnapshot?'no_activity':'no_data'};
            continue;
          }
          settings??=modelSettings();
          const model=await settings;
          if(!model){outcomes[mode]={status:'model_unavailable'};continue;}
          const id=randomUUID();
          // Store the review and its daily slot together so a restart cannot dispatch it twice.
          await api.commit(async tx=>{
            const state=await tx.doc(DailyScheduleState);
            if(state.task!==api.taskId)return;
            if(state.lastDate!==period.date){state.lastDate=period.date;state.modes={};}
            const {language,objective}=state.settings!;
            await startReview(tx,{id,trigger:'daily',reportIds,period,language,objective},mode,model);
            state.modes[mode]={status:'queued',reviewId:id};
          },ctx);
          outcomes[mode]={status:'queued',reviewId:id};
        }catch(error){
          if(api.signal.aborted)throw error;
          if(error instanceof Error&&['MODEL_REQUIRED','MODEL_CREDENTIAL','MODEL_UNKNOWN','SPEED_UNSUPPORTED','THINKING_UNSUPPORTED'].includes(error.message)){
            outcomes[mode]={status:'model_unavailable'};
          }else{
            api.report(error);
            outcomes[mode]={status:'error'};
          }
        }
      }
      const retry=api.now()<tomorrow&&modes.some(mode=>outcomes[mode]?.status!=='queued');
      const until=retry?Math.min(api.now()+hour/2,tomorrow):tomorrow;
      return api.commit(async tx=>{
        const state=await tx.doc(DailyScheduleState);
        if(state.task!==api.taskId)return retired;
        Object.assign(state,{
          modes:outcomes,lastDate:period.date,nextAt:iso(tomorrow),nextCheckAt:iso(until),
        });
        return {status:'sleeping',until,checkpoint:{phase:'run',due:retry?due:tomorrow}};
      },ctx);
    }},abort:(_task,api,ctx)=>api.commit(()=>({status:'terminal',outcome:{status:'aborted'}}),ctx),
  });
}

export async function ensureDailySchedule(tx:Tx,task:ReturnType<typeof createDailySchedule>,now:number,settings:ReviewSettings){
  const state=await tx.doc(DailyScheduleState);
  const previous=state.task,sameTime=state.settings?.time===settings.time;
  state.settings=settings;
  if(settings.enabled){
    if(previous&&sameTime)return null;
    const [hours,minutes]=settings.time.split(':').map(Number);
    const due=localMidnight(now)+hours*hour+minutes*60_000;
    state.task=await tx.createTask(task,{due},{ownership:{kind:'conversation'},background:true});
    state.nextAt=state.nextCheckAt=iso(due);
  }else{
    state.task=state.nextAt=state.nextCheckAt=null;
  }
  return previous;
}
