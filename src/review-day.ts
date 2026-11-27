import BigNumber from 'bignumber.js';
import type {Report} from './performance.ts';

export type ReviewPeriod={start:string;end:string;date?:string};
type Fill=Report['fills'][number];
type Position=Report['positions'][number];

export function utc(time:string){
  const subsecond=time.match(/T\d\d:\d\d:\d\d\.(\d+)/i)?.[1]??'';
  return new Date(time).toISOString().slice(0,-1)+subsecond.padEnd(9,'0').slice(3,9)+'Z';
}

function dayBounds(period:ReviewPeriod,capture:Report){
  const start=Math.max(Date.parse(period.start),capture.coverageStart?Date.parse(capture.coverageStart):-Infinity);
  const end=Date.parse(period.end),asOf=Date.parse(capture.asOf);
  const inside=(t:string)=>{const ms=Date.parse(t);return start<=ms&&ms<end&&(ms<asOf||ms===asOf&&utc(t)<=utc(capture.asOf));};
  const carried=(p:Position)=>asOf>=end&&Date.parse(p.opened)<end&&(!p.closed||Date.parse(p.closed)>=end);
  return {inside,carried};
}

export function hasDailyActivity(report:Report,period:ReviewPeriod){
  if(Date.parse(report.asOf)<Date.parse(period.start)||report.coverageStart&&Date.parse(report.coverageStart)>=Date.parse(period.end))return false;
  const {inside,carried}=dayBounds(period,report);
  return report.fills.some(f=>inside(f.time))||report.positions.some(p=>
    (p.closed&&inside(p.closed))||carried(p)||(!p.closed&&inside(report.asOf)&&Date.parse(p.opened)<=Date.parse(report.asOf)));
}

// Sum native decimal amounts by currency and simultaneous close time before measuring drawdown.
function dayCurrencies(positions:Position[],fills:Fill[]):Report['currencies']{
  const ledger=new Map<string,{wins:number;loss:BigNumber;gain:BigNumber;fees:BigNumber;closes:number;changes:Map<string,BigNumber>}>();
  function money(value:string){
    const split=value.lastIndexOf(' '),currency=value.slice(split+1),amount=new BigNumber(value.slice(0,split));
    if(split<1||!currency||!amount.isFinite())return;
    if(!ledger.has(currency))ledger.set(currency,{wins:0,loss:new BigNumber(0),gain:new BigNumber(0),fees:new BigNumber(0),closes:0,changes:new Map()});
    return {amount,row:ledger.get(currency)!};
  }
  for(const position of positions){
    const m=position.realizedPnl&&money(position.realizedPnl);
    if(!m)continue;
    const {row,amount}=m,time=utc(position.closed!);
    row.closes++;
    if(amount.gt(0)){row.wins++;row.gain=row.gain.plus(amount);}
    else row.loss=row.loss.minus(amount);
    row.changes.set(time,(row.changes.get(time)??new BigNumber(0)).plus(amount));
  }
  for(const fill of fills){
    const m=fill.commission&&money(fill.commission);
    if(m)m.row.fees=m.row.fees.plus(m.amount);
  }
  return [...ledger].map(([currency,row])=>{
    let pnl=new BigNumber(0),peak=pnl,drawdown=pnl;
    const curve=[...row.changes.keys()].sort().map(time=>{
      pnl=pnl.plus(row.changes.get(time)!);
      peak=BigNumber.max(peak,pnl);drawdown=BigNumber.max(drawdown,peak.minus(pnl));
      return {time,pnl:pnl.toString()};
    });
    return {currency,curve,realizedPnl:pnl.toString(),maxDrawdown:drawdown.toString(),fees:row.fees.toString(),
      closedCount:row.closes,winRate:row.closes?row.wins/row.closes:null,profitFactor:row.loss.gt(0)?row.gain.div(row.loss).toNumber():null};
  });
}

export function dailySources(reports:Report[],period:ReviewPeriod){
  const start=Date.parse(period.start),end=Date.parse(period.end);
  const scopes=Map.groupBy(reports,r=>JSON.stringify([r.mode,r.accountId,r.strategyId]));
  return [...scopes.values()].map(captures=>{
    captures.sort((a,b)=>utc(b.asOf).localeCompare(utc(a.asOf))||a.id.localeCompare(b.id));
    const primary=captures[0],owners=new Map<Fill|Position,string>();
    const executions=new Map<string,Fill>(),cycles=new Set<string>(),closed:Position[]=[],atEnd:Position[]=[];
    const contributors=new Set<string>();
    for(const capture of captures){
      const {inside,carried}=dayBounds(period,capture);
      for(const f of capture.fills){
        if(!inside(f.time))continue;
        const key=JSON.stringify([f.instrument,f.orderId,f.tradeId]);
        if(executions.has(key))continue;
        executions.set(key,f);owners.set(f,capture.id);contributors.add(capture.id);
      }
      for(const p of capture.positions){
        const closedToday=p.closed&&inside(p.closed);
        if(!closedToday&&!carried(p))continue;
        // The first native fill survives a NETTING cycle's snapshot ID change.
        const key=JSON.stringify([p.instrument,utc(p.opened),p.side,p.openingTradeId??p.tradeIds[0]??p.id]);
        if(cycles.has(key))continue;
        cycles.add(key);owners.set(p,capture.id);contributors.add(capture.id);
        (closedToday?closed:atEnd).push(p);
      }
    }
    const fills=[...executions.values()];
    const config=captures.find(r=>r.parameters&&Date.parse(r.asOf)>=start&&Date.parse(r.asOf)<end);
    if(config)contributors.add(config.id);
    contributors.add(primary.id);
    const partialOpen=Date.parse(primary.asOf)<end?primary.positions.filter(p=>!p.closed&&Date.parse(p.opened)<=Date.parse(primary.asOf)):[];
    const report:Report={...primary,parameters:config?.parameters,balances:[],fills,positions:closed,currencies:dayCurrencies(closed,fills)};
    return {report,atEnd,partialOpen,owners,parameterOwner:config?.id,parameterAsOf:config?.asOf,sourceReportIds:[...contributors],
      endObserved:captures.some(r=>Date.parse(r.asOf)>=end),
      hasDayCapture:captures.some(r=>r.coverageStart&&Date.parse(r.coverageStart)<=start&&Date.parse(r.asOf)>=end)};
  });
}
export type DailySource=ReturnType<typeof dailySources>[number];
