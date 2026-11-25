export const metrics = ['ic','rank_ic','icir','rank_icir','mi'] as const;
export const paper = {initial:80, parents:32, children:96, generations:24, subcycle:8, injectEvery:2, inject:8, parallel:8, repairs:2, plateauWindow:0, plateauDelta:0.001, nanLimit:0.3, qualified:0.65, elite:0.8, floors:[0.005,0.005,0.05,0.05,0.02], eliteFloors:[0.01,0.01,0.1,0.1,0.02]};
export const minute = {...paper, initial:24, parents:12, children:36, generations:8, inject:4, floors:[0.002,0.002,0.025,0.025,0.005], eliteFloors:[0.004,0.004,0.05,0.05,0.01]};
export const roles = [
  [['MarketCycle','Identify transitions and recurring phases from multiscale returns.'],['VolatilityRegime','Compare current volatility with the instrument’s past regime.']],
  [['TailRisk','Measure downside tails and stress accumulation.'],['CrashPredictor','Seek precursors of abrupt price deterioration.']],
  [['Liquidity','Estimate liquidity and price impact with price and volume.'],['OrderImbalance','Use bar-based proxies; do not assume order book data.'],['PriceVolumeCoherence','Measure alignment between price changes and volume.'],['VolumeStructure','Find shifts in the distribution and persistence of traded volume.']],
  [['DailyTrend','Extract persistent direction across rolling horizons.'],['Reversal','Identify temporary dislocations and reversal conditions.'],['RangeVol','Use high–low and open–close geometry to estimate volatility.'],['LagResponse','Measure delayed responses to past shocks.'],['VolAsymmetry','Contrast upside and downside variability.']],
  [['Drawdown','Study drawdown depth and recovery shape.'],['Fractal','Study multiscale roughness and persistence.']],
  [['RegimeGating','Condition signals on observable changes in market state.'],['Stability','Prefer signals whose behavior survives changing local conditions.']],
  [['BarShape','Use candle-body and wick geometry.'],['Creative','Propose a distinct mechanism with an explicit falsifiable premise.'],['Composite','Combine complementary mechanisms without redundant variables.'],['Herding','Distinguish coordinated moves using contemporaneous observations.']]
].flatMap((tier,i)=>tier.map(([name,guide])=>({name,guide,tier:i+1})));
export const modes = [
  'Light: preserve the hypothesis and adjust its wording.',
  'Moderate: recast the hypothesis while preserving its focus.',
  'Creative: add a defensible interpretation within the same theme.',
  'Divergent: explore a related but distinct hypothesis.',
  'Concrete: express the hypothesis as measurable operations.'
];
export function rng(seed:number) {let state=seed>>>0; return ()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};}
export function shuffle<T>(xs:T[], random:()=>number) {const result=[...xs];for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;}
export function quantile(xs:number[], q:number) {if(!xs.length)return null;const a=[...xs].sort((x,y)=>x-y), p=q*(a.length-1), i=Math.floor(p);return a[i]+(a[Math.ceil(p)]-a[i])*(p-i);}
export type Candidate = {id:string; parents:string[]; operation:string; role:string; mode:string; revisions: {stage:string; name:string; hypothesis:string; formula:string; code:string}[]; reviews:{stage:string; reason:string; pass:boolean}[]; scores?:Record<string,number|null>; failure?:string; coverage?:unknown};
export function select(rows:Candidate[], prior:Candidate[], config=paper, keys:readonly string[]=metrics) {
  const eligible=rows.filter(a=>!a.failure && keys.every(k=>Number.isFinite(a.scores?.[k])));
  const bands=(q:number)=>keys.map(k=>quantile(eligible.map(a=>a.scores![k]!),q));
  const qualified=bands(config.qualified), elite=bands(config.elite);
  const pass=(a:Candidate,b:(number|null)[],floors:number[])=>keys.every((k,i)=>b[i]!==null && a.scores![k]!>b[i]! && a.scores![k]!>=floors[i]);
  const compare=(a:Candidate,b:Candidate)=>keys.map(k=>(b.scores![k]??0)-(a.scores![k]??0)).find(n=>n!==0) || a.id.localeCompare(b.id);
  const elites=eligible.filter(a=>pass(a,elite,config.eliteFloors)).sort(compare);
  const carry=[...prior].sort(compare).slice(0,2);
  const parents=[...new Map([...carry,...eligible.filter(a=>pass(a,qualified,config.floors)).sort(compare)].map(a=>[a.id,a])).values()].slice(0,config.parents);
  const negative=rows.filter(a=>!a.scores || a.failure || !pass(a,qualified,config.floors)).sort((a,b)=>Number(!a.failure)-Number(!b.failure) || (a.scores&&b.scores?compare(b,a):a.id.localeCompare(b.id)));
  return {qualified,elite,elites,parents,negative:negative.slice(0,2),eligible};
}
