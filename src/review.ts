import {defineDoc,defineDocFamily,defineTask} from '@earendil-works/pi-durable';
import {arr,compile,equal,obj,oneOf,opt,str} from '@earendil-works/pi-schema';
import {PerformanceReport} from './performance.ts';
import {strategyId} from './strategy.ts';
import {defaultReview,type ReviewSettings} from './settings.ts';
import type {Ask} from './extension.ts';
import {reviewContext,diagnosisPrompt,decisionPrompt,validateDiagnosis,validateDecisions,type ReviewContext} from './review-analysis.ts';

const uuid=str({pattern:strategyId.source});
const request=compile(obj({id:uuid,reportIds:arr(uuid,{minItems:1,maxItems:8,uniqueItems:true}),
  objective:opt(str({maxLength:2000})),language:opt(oneOf(['zh-CN','en']))}));
export function reviewRequest(raw:unknown,defaults:Pick<ReviewSettings,'language'|'objective'>=defaultReview){
  if(!request.check(raw))throw Error('BAD_REQUEST');
  return {id:raw.id,reportIds:raw.reportIds,objective:(raw.objective??defaults.objective).trim(),language:raw.language??defaults.language};
}
export function sameReviewRequest(prior:ReturnType<typeof reviewRequest>,input:ReturnType<typeof reviewRequest>){
  return prior.objective===input.objective&&prior.language===input.language&&equal(prior.reportIds,input.reportIds);
}

export const Reviews=defineDoc<any>({
  kind:'alpha.performance.reviews',version:1,scope:'session',initial:()=>({reviews:{}}),checkpointWhen:()=>true,
});
export const ReviewInputs=defineDocFamily<ReviewContext,ReviewContext>({
  kind:'alpha.performance.review_input',version:1,scope:'session',family:true,initial:context=>context,checkpointWhen:()=>true,
});

export function createPerformanceReview(ask:Ask,parse:(answer:string)=>any){
  return defineTask<any,any,any>({
    name:'alphazonai.performance_review',version:1,initial:()=>({phase:'prepare'}),
    phases:{
      prepare:async(task,api,ctx)=>{
        const {id,reportIds,objective,language,period}=task.input;
        let context;
        try{
          const reports=[];
          for(const reportId of reportIds){
            const report=await api.snapshot(PerformanceReport,reportId,ctx);
            if(!report)throw Error('PERFORMANCE_REPORT_MISSING');
            reports.push(report);
          }
          context=reviewContext(reports,objective,language,period);
        }catch(e){return failed(id,e,api,ctx);}
        return api.commit(async tx=>{
          await tx.doc(ReviewInputs,id,context);
          return {status:'pending',checkpoint:{phase:'diagnosis'}};
        },ctx);
      },
      diagnosis:async(task,api,ctx)=>{
        const {id}=task.input;
        let diagnosis;
        try{
          const context=(await api.snapshot(ReviewInputs,id,ctx))!;
          const answer=await ask(api,ctx,'review:diagnosis',diagnosisPrompt(context));
          diagnosis=validateDiagnosis(parse(answer),context);
        }catch(e){return failed(id,e,api,ctx);}
        return api.commit(async tx=>{
          const review=(await tx.doc(Reviews)).reviews[id];
          Object.assign(review,{diagnosis,status:'deciding'});
          return {status:'pending',checkpoint:{phase:'decision'}};
        },ctx);
      },
      decision:async(task,api,ctx)=>{
        const {id}=task.input;
        let decisions;
        try{
          const {diagnosis}=(await api.snapshot(Reviews,ctx))!.reviews[id];
          const context=(await api.snapshot(ReviewInputs,id,ctx))!;
          const answer=await ask(api,ctx,'review:decision',decisionPrompt(context,diagnosis));
          decisions=validateDecisions(parse(answer),context);
        }catch(e){return failed(id,e,api,ctx);}
        return api.commit(async tx=>{
          Object.assign((await tx.doc(Reviews)).reviews[id],{decisions,status:'completed'});
          return {status:'terminal',outcome:{status:'completed',result:null}};
        },ctx);
      },
    },
  });
}

function failed(id:string,error:unknown,api:any,ctx:any){
  if(api.signal.aborted)throw error;
  const message=error instanceof Error?error.message:'';
  const code=['MODEL_FORMAT','MODEL_EMPTY','MODEL_UNANSWERED','PERFORMANCE_REPORT_MISSING'].includes(message)?message:'PERFORMANCE_REVIEW_FAILED';
  return api.commit(async (tx:any)=>{
    Object.assign((await tx.doc(Reviews)).reviews[id],{error:code,status:'failed'});
    return {status:'terminal',outcome:{status:'failed',error:{message:code}}};
  },ctx);
}
