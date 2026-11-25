import {timingSafeEqual} from 'node:crypto';

export const MAX_DIRECTION_LENGTH=4000;
const settings=['preset','start','end','horizon','seed','provider','model','thinking','speed','parallel','generations','plateauWindow'] as const;
export function researchDirection(raw:unknown){
  if(raw===undefined||raw===null)return '';
  if(typeof raw!=='string'||raw.length>MAX_DIRECTION_LENGTH)throw Error('INVALID_RESEARCH_DIRECTION');
  return raw.trim();
}
export function runAdmission(raw:Record<string,unknown>){
  const result:Record<string,string|number|null>={direction:researchDirection(raw.direction)};
  for(const key of settings){
    const val=raw[key];
    if(val===undefined)continue;
    if(val!==null&&typeof val!=='string'&&typeof val!=='number')throw Error('BAD_REQUEST');
    result[key]=val;
  }
  return result;
}
export function sameRunAdmission(a:Record<string,unknown>|undefined,b:Record<string,unknown>){
  // Older runs have no stored request. Keep their IDs reserved and never restart them.
  return !a||[...settings,'direction'].every(k=>a[k]===b[k]);
}
export function researchPromptContext(input:{direction?:unknown;horizon?:unknown;barSpec?:unknown}={}){
  const context={
    objective:'Test whether factor scores at each timestamp relate to subsequent per-instrument returns across the available instruments. Do not equate statistical scores to trading results.',
    predictionHorizonMinutes:Number.isSafeInteger(input.horizon)&&Number(input.horizon)>0?input.horizon:null,
    sourceBars:typeof input.barSpec==='string'?input.barSpec:null,
    researchDirection:typeof input.direction==='string'&&input.direction.trim()?input.direction.trim():null,
  };
  return 'Run research context (JSON): '+JSON.stringify(context)+'\n'+
    'Apply the research direction to the hypothesis, generated code and review when present. A prediction horizon is the scoring label interval, not a holding period. Keep the actual data contract. Do not assume unprovided features (including historical market cap), invent data or relax causality. If a constraint cannot be evaluated, say so in the relevant hypothesis or review.';
}
export function agentWriteError(headers:{origin?:string;browser?:string;authorization?:string;localHost:boolean},expected?:string){
  if(headers.origin!==undefined||headers.browser!==undefined)return 'WEB_READ_ONLY';
  if(!expected)return headers.localHost?null:'AGENT_AUTH_REQUIRED';
  const supplied=Buffer.from(headers.authorization??'');
  const wanted=Buffer.from('Bearer '+expected);
  return supplied.length===wanted.length&&timingSafeEqual(supplied,wanted)?null:'AGENT_AUTH_REQUIRED';
}
