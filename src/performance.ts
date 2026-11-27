import {defineDoc,defineDocFamily,type Tx} from '@earendil-works/pi-durable';
import {arr,bool,compile,equal,int,map,nullable,num,obj,oneOf,opt,str,union,type Static} from '@earendil-works/pi-schema';
import {formats} from '@earendil-works/pi-schema/formats';
import {strategyId} from './strategy.ts';

const uuid=str({pattern:strategyId.source});
const label=str({minLength:1});
const time=str({format:'date-time'});
const decimal=str({pattern:'^[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?$'});
const identity={id:uuid,sessionId:uuid,mode:oneOf(['paper','live']),accountId:label,strategyId:label,asOf:time,coverageStart:opt(time)};
const summary=obj(identity);
const reportSchema=obj({
  ...identity,
  parameters:opt(map(union([bool(),num(),str()]))),
  currencies:arr(obj({
    currency:label,realizedPnl:decimal,maxDrawdown:decimal,closedCount:int({minimum:0}),
    winRate:nullable(num({minimum:0,maximum:1})),profitFactor:nullable(num({minimum:0})),fees:decimal,
    curve:arr(obj({time,pnl:decimal})),
  })),
  balances:arr(obj({currency:label,total:decimal,free:decimal,locked:decimal})),
  fills:arr(obj({
    time,tradeId:label,orderId:label,positionId:nullable(label),instrument:label,side:label,
    quantity:decimal,price:decimal,currency:label,commission:nullable(label),liquidity:label,
  })),
  positions:arr(obj({
    id:label,instrument:label,side:label,opened:time,closed:nullable(time),quantity:decimal,peakQuantity:decimal,
    realizedPnl:nullable(label),tradeIds:arr(label),openingTradeId:opt(label),
  })),
});
const reportValidator=compile(reportSchema,{formats});
export type Report=Static<typeof reportSchema>;
type Summary=Static<typeof summary>;

export const PerformanceIndex=defineDoc<{reports:Record<string,Summary>}>({
  kind:'alpha.performance.index',version:1,scope:'session',initial:()=>({reports:{}}),checkpointWhen:()=>true,
});
export const PerformanceReport=defineDocFamily<Report,Report>({
  kind:'alpha.performance.report',version:1,scope:'session',family:true,initial:report=>report,checkpointWhen:()=>true,
});

export function performanceReport(raw:unknown){
  if(!reportValidator.check(raw)||(raw.coverageStart&&Date.parse(raw.coverageStart)>Date.parse(raw.asOf)))throw Error('INVALID_PERFORMANCE_REPORT');
  return raw;
}

export async function importPerformance(tx:Tx,report:Report){
  const {id,sessionId,mode,accountId,strategyId,asOf,coverageStart}=report;
  const index=await tx.doc(PerformanceIndex);
  const stored=await tx.doc(PerformanceReport,id,report);
  if(Object.hasOwn(index.reports,id))return equal(stored,report)?200:409;
  index.reports[id]={id,sessionId,mode,accountId,strategyId,asOf,...(coverageStart?{coverageStart}:{})};
  return 201;
}
