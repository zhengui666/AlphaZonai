import {packs} from './locale.js';
import {settingsPage} from './settings.js';
import {aiReview,reviewPath,reviewRoute} from './reviews.js';

const $=id=>document.getElementById(id);
let lang=Object.hasOwn(packs,localStorage.getItem('alpha.locale'))?localStorage.getItem('alpha.locale'):'en';
let runs=[],loaded=false,active,stream,selectedId,candidate,generation,errorCode,view,routeVersion=0;
let reviewMode='paper',reviewId,reviewList,reviewData,reviewError,reviewRef=[],aiController;
const targets=new Map();
const t=k=>packs[lang][k]||packs.en[k]||k;
const node=(name,text,cls)=>{const el=document.createElement(name);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
const number=(v,digits=5)=>v==null?'—':typeof v==='number'?new Intl.NumberFormat(lang,{maximumFractionDigits:digits}).format(v):v;
const date=v=>{
  if(!v)return '—';
  const parsed=new Date(v);
  return Number.isNaN(parsed.getTime())?v:new Intl.DateTimeFormat(lang,{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'}).format(parsed);
};
const makeOption=(value,text)=>{const el=node('option',text);el.value=value;return el;};
const take=(arr=[])=>Array.isArray(arr)?arr:[];
const state=(s,style=s)=>node('span',t(s||'empty'),'state '+(/^[-a-z_]+$/.test(style||'')?style:''));
const link=(text,url,cls)=>{const el=node('a',text,cls);el.href=url;return el;};
function lookup(k){return t('metric_'+k)==='metric_'+k?k.replaceAll('_',' '):t('metric_'+k);}
function err(code){errorCode=code;$('error').hidden=!code;$('error').textContent=code?t(code):'';}
async function api(path,body,signal){
  const init=body===undefined?{signal}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal};
  const r=await fetch('/api'+path,init);const payload=await r.json();
  if(!r.ok)throw Error(payload.error||'SERVER_ERROR');return payload;
}
function updateTargets(items){
  targets.clear();
  for(const target of items)targets.set(target.id,target.label);
  if(view==='run')render();
}
const settings=settingsPage({t,makeOption,api,updateTargets});
const runTitle=r=>{
  const dir=r.input?.direction?.trim()||r.direction?.trim();
  return dir?([...dir].length>150?[...dir].slice(0,150).join('')+'…':dir):t(r.preset);
};
const hashFor=id=>'#run/'+encodeURIComponent(id);
const runUrl=id=>'/api/runs/'+encodeURIComponent(id);
const onAir=new Set(['queued','running','pausing']);

function stat(label,value,detail){
  const el=node('div',undefined,'stat');el.append(node('div',label,'label'),node('strong',value));
  if(detail!=null)el.append(node('small',detail));return el;
}
function properties(rows){
  const dl=node('dl',undefined,'properties');
  for(const [label,value] of rows){const group=node('div');group.append(node('dt',label),node('dd',value==null?'—':value));dl.append(group);}
  return dl;
}
function detailPanel(title,content){
  const el=node('details',undefined,'disclosure');el.append(node('summary',title),content);return el;
}
function panel(title,content,className=''){
  const el=node('section',undefined,'panel '+className);el.append(node('h2',title),content);return el;
}
function blank(text){
  const el=node('div',undefined,'blank');el.append(node('span','∿','blank-icon'),node('h2',text));el.firstChild.setAttribute('aria-hidden','true');return el;
}
function table(headers,rows){
  const el=node('table');const th=node('thead');const tr=node('tr');
  for(const h of headers){const x=node('th',h);x.scope='col';tr.append(x);}th.append(tr);el.append(th);
  const body=node('tbody');
  for(const row of rows){const line=node('tr');for(const val of row){const cell=node('td');if(val instanceof Node)cell.append(val);else cell.textContent=val??'—';line.append(cell);}body.append(line);}
  el.append(body);const wrapper=node('div',undefined,'table-scroll');wrapper.tabIndex=0;wrapper.append(el);return wrapper;
}
function mast(tag,title){
  const header=node('header',undefined,'mast');header.append(node('div',tag,'eyebrow'),node('h1',title));return header;
}
function drawRuns(){
  $('runs').replaceChildren(...runs.map(r=>{
    const a=link(runTitle(r),hashFor(r.id),'report-link');
    if(r.id===selectedId)a.setAttribute('aria-current','page');
    a.replaceChildren(node('span',runTitle(r),'rail-title'),node('small',date(r.created)));
    a.append(node('i',undefined,'status-dot '+(/^[-a-z]+$/.test(r.status)?r.status:'')));return a;
  }));
  for(const [id,mode] of [['overviewLink','overview'],['performanceLink','performance'],['settingsLink','settings']]){
    if(view===mode)$(id).setAttribute('aria-current','page');else $(id).removeAttribute('aria-current');
  }
}
function overview(){
  const el=$('overviewContent');el.setAttribute('aria-busy',String(!loaded));
  if(!loaded){el.replaceChildren(blank(t('loading')));return;}
  if(!runs.length){el.replaceChildren(blank(t('noReports')));return;}
  const stats=node('div',undefined,'stat-grid');
  stats.append(stat(t('reports'),number(runs.length)),stat(t('activeRuns'),number(runs.filter(r=>onAir.has(r.status)).length)),stat(t('completed'),number(runs.filter(r=>r.status==='completed').length)));
  const reportTable=table([t('research'),t('status'),t('generation'),t('created')],runs.map(r=>[
    link(runTitle(r),hashFor(r.id),'record'),state(r.status),r.current!=null?number(r.current):'—',date(r.created),
  ]));
  el.replaceChildren(stats,panel(t('reports'),reportTable,'table-panel'));
}
async function refreshRuns(){
  try{runs=take(await api('/runs'));loaded=true;drawRuns();if(view==='overview')overview();}
  catch(e){err(e.message);}
}
async function open(id,version){
  $('detail').replaceChildren(blank(t('loading')));
  try{
    const result=await api('/runs/'+encodeURIComponent(id));
    if(selectedId!==id||version!==routeVersion)return;
    active=result;render();
    stream=new EventSource('/api/runs/'+encodeURIComponent(id)+'/events');
    stream.onmessage=e=>{
      if(selectedId!==id||version!==routeVersion)return;
      try{
        const next=JSON.parse(e.data);
        if(next.id!==id||JSON.stringify(next)===JSON.stringify(active))return;
        active=next;
        const i=runs.findIndex(x=>x.id===id);
        if(i>=0)runs[i]={...runs[i],direction:active.input?.direction,status:active.status,current:active.current};
        drawRuns();render();
      }catch{err('SERVER_ERROR');}
    };
  }catch(e){if(selectedId===id&&version===routeVersion){$('detail').replaceChildren(blank(t(e.message)));}}
}
function route(){
  const version=++routeVersion;
  const hash=location.hash.slice(1);
  const review=reviewRoute(hash);
  const settingsRoute=hash.match(/^settings(?:\/(model|nautilus|review|data))?$/);
  reviewRef=review?.parts||[];
  aiController?.abort();
  const id=hash.replace(/^run\//,'');
  const prior=selectedId;
  selectedId=/^[0-9a-f-]{36}$/i.test(id)?id:undefined;
  view=selectedId?'run':review?'performance':settingsRoute?'settings':'overview';
  stream?.close();stream=undefined;err();
  $('overview').hidden=view!=='overview';$('detail').hidden=view!=='run';$('settings').hidden=view!=='settings';$('performance').hidden=view!=='performance';
  if(prior!==selectedId){active=undefined;candidate=undefined;generation=undefined;}
  drawRuns();
  if(view==='settings')settings.open(settingsRoute[1]||'model');else settings.close();
  if(view==='run')void open(selectedId,version);
  else if(view==='performance')void openReview(review.mode,review.id,version);
  else if(view==='overview')overview();
}

function svg(tag,attrs={}){
  const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);
  return el;
}
const utc=value=>value?new Date(value).toISOString().slice(0,19).replace('T',' ')+(value.match(/T\d\d:\d\d:\d\d(\.\d+)/i)?.[1]||''):'—';
async function openReview(mode,id,version){
  reviewMode=mode;reviewId=id;reviewList=reviewData=reviewError=undefined;
  renderReview();
  try{
    const {reports}=await api('/performance');
    if(version!==routeVersion)return;
    reviewList=reports;
    reviewId=id||reports.find(r=>r.mode===mode)?.id;
    if(reviewId&&!reports.some(r=>r.mode===mode&&r.id===reviewId))throw Error('NOT_FOUND');
    renderReview();
    if(reviewId){
      const report=await api('/performance/'+encodeURIComponent(reviewId));
      if(version!==routeVersion)return;
      reviewData=report;renderReview();
    }
  }catch(e){if(version===routeVersion){reviewError=e.message;renderReview();}}
}
function renderReview(){
  aiController?.abort();
  for(const a of $('reviewModes').querySelectorAll('a')){
    if(a.hash===reviewPath(reviewMode))a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  }
  const select=$('reviewSession'),content=$('reviewContent');
  const choices=(reviewList||[]).filter(r=>r.mode===reviewMode);
  $('reviewPicker').hidden=!choices.length;
  select.replaceChildren(...choices.map(r=>makeOption(r.id,[r.strategyId,r.accountId,utc(r.asOf)+' UTC'].join(' · '))));
  select.value=reviewId||'';
  content.setAttribute('aria-busy',String(!reviewError&&!reviewData&&(!reviewList||!!reviewId)));
  if(reviewError){content.replaceChildren(blank(t(reviewError)));return;}
  if(!reviewList||reviewId&&!reviewData){content.replaceChildren(blank(t('loading')));return;}
  aiController=new AbortController();
  const ai=aiReview(reviewMode,reviewData,reviewList,{lang,t,node,link,detailPanel,properties,makeOption,api,utc},aiController.signal);
  if(!reviewData){
    const box=blank(t(reviewMode==='live'?'noLiveReports':'noPaperReports'));
    box.append(node('p',t('importSnapshot'),'subtle'),node('code','alphazonai performance import --report-file report.json'));
    content.replaceChildren(ai,box);return;
  }
  const r=reviewData;
  const metadata=properties([[t('tradingStrategy'),r.strategyId],[t('account'),r.accountId],
    ...(r.coverageStart?[[t('snapshotStart'),utc(r.coverageStart)]]:[]),[t('snapshotTime'),utc(r.asOf)],[t('nodeSession'),r.sessionId]]);
  const ref=reviewRef;
  const instrument=ref[0]==='instrument'?ref[1]:null;
  const positions=instrument?r.positions.filter(p=>p.instrument===instrument):r.positions;
  const fills=instrument?r.fills.filter(f=>f.instrument===instrument):r.fills;
  const fillBox=node('div',undefined,'review-fills');
  function showFills(position){
    const tradeIds=new Set(position?.tradeIds);
    const rows=position?fills.filter(f=>f.instrument===position.instrument&&tradeIds.has(f.tradeId)):fills;
    fillBox.replaceChildren();
    if(position){
      const filter=node('div',undefined,'section-heading');
      const clear=node('button',t('allFills'));clear.type='button';
      clear.onclick=()=>{showFills();fillBox.focus();};
      filter.append(node('span',t('positionId')+' · '+position.id),clear);fillBox.append(filter);
    }
    fillBox.append(reviewLedger(
      ['fillTime','instrument','tradeSide','fillQuantity','fillPrice','currency','commission','liquidity','orderId','tradeId','positionId'],
      rows,f=>[utc(f.time),f.instrument,t(f.side),f.quantity,f.price,f.currency,f.commission,t(f.liquidity||'—'),f.orderId,f.tradeId,f.positionId],
      'noFills',ref[0]==='fill'?rows.findIndex(f=>f.instrument===ref[1]&&f.orderId===ref[2]&&f.tradeId===ref[3]):-1));
  }
  fillBox.tabIndex=-1;showFills();
  const positionRows=reviewLedger(
    ['positionId','instrument','positionSide','openedTime','closedTime','openQuantity','peakQuantity','positionPnl'],
    positions,p=>{
      let id=p.id;
      if(p.tradeIds?.length){
        const b=node('button',id,'record');b.type='button';b.setAttribute('aria-label',t('fillsForPosition')+' '+id);
        b.onclick=()=>{showFills(p);fillBox.focus();};id=b;
      }
      return [id,p.instrument,t(p.side),utc(p.opened),p.closed?utc(p.closed):t('openPosition'),p.quantity,p.peakQuantity,p.realizedPnl];
    },'noPositions',ref[0]==='position'?positions.findIndex(p=>p.id===ref[1]&&p.opened===ref[2]):-1);
  const metrics=currencyReview(r.currencies,ref[1]),params=Object.entries(r.parameters||{});
  const positionPanel=panel(t('positionReview'),positionRows);
  if(instrument){
    const header=node('div',undefined,'section-heading');
    header.append(node('h2',t('positionReview')+' · '+instrument),link(t('showAllInstruments'),reviewPath(reviewMode,r.id),'button'));
    positionPanel.firstChild.replaceWith(header);
  }
  content.replaceChildren(ai,metadata,metrics,
    positionPanel,panel(t('executionReview')+(instrument?' · '+instrument:''),fillBox),
    panel(t('accountBalances'),r.balances.length?table([t('currency'),t('totalBalance'),t('freeBalance'),t('lockedBalance')],r.balances.map(b=>[b.currency,b.total,b.free,b.locked])):node('p',t('noBalances'),'subtle')));
  if(params.length){
    const values=properties(params.map(([k,v])=>[k,String(v)]));
    const idx=params.findIndex(([k])=>k===ref[1]);
    if(ref[0]==='parameter'&&idx>=0)values.children[idx].classList.add('ref-property');
    content.append(detailPanel(t('strategyParameters'),values));
  }
  const target=ref[0]==='position'||ref[0]==='fill'?content.querySelector('.ref-row'):
    ['currency','window','fees'].includes(ref[0])?metrics:instrument?positionPanel:ref[0]==='parameter'&&params.length?content.lastChild:null;
  if(target){if(target.tagName==='DETAILS')target.open=true;target.scrollIntoView({block:'center'});}
}
$('reviewRefresh').onclick=route;
$('reviewSession').onchange=e=>{location.hash=reviewPath(reviewMode,e.target.value);};

// Native timelines are chronological. Page newest-first without reversing the source.
function reviewLedger(keys,entries,cells,empty,selected=-1){
  if(!entries.length)return node('p',t(empty),'subtle');
  const wrapper=node('div',undefined,'review-ledger'),grid=node('div'),pager=node('div',undefined,'review-pages');
  const prev=node('button',t('newerRows')),next=node('button',t('olderRows')),range=node('span');
  range.setAttribute('role','status');prev.type=next.type='button';
  const size=25;
  let offset=selected<0?0:Math.floor((entries.length-selected-1)/size)*size;
  function draw(){
    const end=entries.length-offset,start=Math.max(0,end-size);
    grid.replaceChildren(table(keys.map(t),entries.slice(start,end).reverse().map(cells)));
    if(selected>=start&&selected<end)grid.querySelector('tbody').rows[end-selected-1].classList.add('ref-row');
    range.textContent=number(offset+1)+'–'+number(entries.length-start)+' / '+number(entries.length);
    prev.disabled=offset===0;next.disabled=start===0;
  }
  prev.onclick=()=>{offset-=size;draw();};next.onclick=()=>{offset+=size;draw();};
  pager.append(range,prev,next);wrapper.append(grid);if(entries.length>size)wrapper.append(pager);
  draw();return wrapper;
}
function currencyReview(currencies,currency){
  const body=node('div',undefined,'currency-review');
  const heading=node('div',undefined,'section-heading');
  const box=node('section',undefined,'panel');box.append(heading,body);
  heading.append(node('h2',t('closedPerformance')));
  if(!currencies.length){body.append(node('p',t('noCurrencyReport'),'subtle'));return box;}
  const selector=node('select');selector.setAttribute('aria-label',t('currency'));
  selector.append(...currencies.map(c=>makeOption(c.currency,c.currency)));heading.append(selector);
  if(currencies.some(c=>c.currency===currency))selector.value=currency;
  function draw(){
    const c=currencies[selector.selectedIndex],stats=node('div',undefined,'stat-grid review-stats');
    const win=c.winRate==null?'—':new Intl.NumberFormat(lang,{style:'percent',maximumFractionDigits:2}).format(c.winRate);
    stats.append(stat(t('realizedNetPnl'),number(c.realizedPnl),c.currency),stat(t('realizedDrawdown'),number(c.maxDrawdown),c.currency),
      stat(t('closedCount'),number(c.closedCount)),stat(t('winRate'),win),stat(t('profitFactor'),number(c.profitFactor,2)),stat(t('fillFees'),number(c.fees),c.currency));
    body.replaceChildren(stats);
    if(c.curve.length)body.append(pnlChart(c));else body.append(node('p',t('noClosedHistory'),'subtle'));
  }
  selector.onchange=draw;draw();return box;
}
function pnlChart(c){
  const fig=node('figure',undefined,'wide-chart pnl-chart');
  fig.append(node('figcaption',t('closedCurve')+' · '+c.currency));
  const graph=svg('svg',{viewBox:'0 0 760 215',role:'img','aria-label':t('closedCurve')+' · '+c.currency});
  const nanos=time=>BigInt(Date.parse(time))*1000000n+BigInt((time.match(/T\d\d:\d\d:\d\d\.(\d+)/i)?.[1]||'').padEnd(9,'0').slice(3,9));
  const points=c.curve,first=nanos(points[0].time),last=nanos(points.at(-1).time);
  let low=0,high=0;
  for(const p of points){low=Math.min(low,Number(p.pnl));high=Math.max(high,Number(p.pnl));}
  const x=time=>first===last?415:90+Number(nanos(time)-first)/Number(last-first)*650;
  const y=pnl=>high===low?103:18+(high-Number(pnl))/(high-low)*148;
  const tick=new Intl.NumberFormat(lang,{maximumSignificantDigits:4});
  for(const v of new Set([high,0,low])){
    graph.append(svg('line',{x1:90,y1:y(v),x2:740,y2:y(v),class:'grid-line'}),svgText(82,y(v)+4,tick.format(v),'axis','end'));
  }
  const path=['M',x(points[0].time),y(0)];
  for(const p of points)path.push('H',x(p.time),'V',y(p.pnl));
  graph.append(svg('path',{d:path.join(' '),class:'pnl-line'}));
  const final=points.at(-1);
  graph.append(marker(svg('circle',{cx:x(final.time),cy:y(final.pnl),r:4,class:'pnl-dot'}),utc(final.time)+' UTC · '+final.pnl+' '+c.currency));
  const timeLabel=p=>(last-first<1000000000n?utc(p.time):utc(p.time).slice(0,19))+' UTC';
  if(first===last)graph.append(svgText(x(final.time),199,timeLabel(final),'axis'));
  else graph.append(svgText(90,199,timeLabel(points[0]),'axis','start'),svgText(740,199,timeLabel(final),'axis','end'));
  fig.append(graph,detailPanel(t('chartData'),reviewLedger(['closedTime','cumulativePnl'],points,p=>[utc(p.time),p.pnl+' '+c.currency],'noClosedHistory')));
  return fig;
}
function svgText(x,y,text,cls,anchor='middle'){
  const el=svg('text',{x,y,class:cls,'text-anchor':anchor});el.textContent=text;return el;
}
function marker(parent,text){const title=svg('title');title.textContent=text;parent.append(title);return parent;}
function generationChart(generations){
  const figure=node('figure',undefined,'wide-chart');
  const legend=node('div',undefined,'legend');
  for(const [text,style] of [['candidates','total'],['retainedParents','qualified'],['elite','elite']]){
    const el=node('span',t(text),style);legend.append(el);
  }
  figure.append(legend);
  const width=740,height=250,top=23,bottom=199,l=42,r=17;
  const graph=svg('svg',{viewBox:'0 0 '+width+' '+height,role:'img','aria-label':t('generationProgress')});
  const max=Math.max(1,...generations.flatMap(g=>[take(g.rows).length,take(g.parents).length,take(g.elites).length]));
  const step=Math.max(1,Math.ceil(max/4));
  const y=v=>bottom-v/(step*4)*(bottom-top);
  for(let i=0;i<=4;i++){
    graph.append(svg('line',{x1:l,y1:y(i*step),x2:width-r,y2:y(i*step),class:'grid-line'}),svgText(l-8,y(i*step)+4,number(i*step,0),'axis','end'));
  }
  const space=(width-l-r)/generations.length;
  const bw=Math.min(20,Math.max(1,space*.22));
  for(let j=0;j<generations.length;j++){
    const g=generations[j],x=l+(j+.5)*space;
    const vals=[take(g.rows).length,take(g.parents).length,take(g.elites).length];
    for(const [i,sty] of ['total','qualified','elite'].entries()){
      const amount=vals[i];if(amount===0)continue;
      const rect=svg('rect',{x:x+(i-1.52)*bw,y:y(amount),width:Math.max(1,bw-2),height:bottom-y(amount),rx:Math.min(3,bw/5),class:'bar '+sty});
      graph.append(marker(rect,t('generation')+' '+g.index+' · '+t(i===0?'candidates':i===1?'retainedParents':sty)+': '+number(amount)));
    }
    if(j===generations.length-1||j%Math.max(1,Math.ceil(generations.length/12))===0)
      graph.append(svgText(x,bottom+19,number(g.index,0),'axis'));
  }
  graph.append(svgText(width*.52,244,t('generation'),'axis'));
  figure.append(graph);
  figure.append(detailPanel(t('chartData'),table([t('generation'),t('candidates'),t('retainedParents'),t('elite')],generations.map(g=>[number(g.index,0),number(take(g.rows).length,0),number(take(g.parents).length,0),number(take(g.elites).length,0)]))));
  return figure;
}
function distribution(g,k){
  const fig=node('figure',undefined,'distribution');
  const vals=take(g.rows).map(row=>row.scores?.[k]).filter(Number.isFinite).sort((a,b)=>a-b);
  fig.append(node('figcaption',lookup(k)));
  if(!vals.length){fig.append(node('p',t('noScores'),'subtle'));return fig;}
  const idx=take(g.keys).indexOf(k);
  const ref=[take(g.qualified)[idx],take(g.elite)[idx]];
  const bounds=[...vals,...ref.filter(Number.isFinite)];
  const min=Math.min(...bounds),max=Math.max(...bounds);
  const range=max-min;
  const plot=svg('svg',{viewBox:'0 0 220 72',role:'img','aria-label':lookup(k)+': '+number(vals[0])+' – '+number(vals.at(-1))});
  const x=n=>range===0?110:12+(n-min)/range*196;
  plot.append(svg('line',{x1:12,y1:54,x2:208,y2:54,class:'grid-line'}));
  for(let j=0;j<ref.length;j++)if(Number.isFinite(ref[j])){
    plot.append(marker(svg('line',{x1:x(ref[j]),x2:x(ref[j]),y1:10,y2:54,class:'reference '+(j?'elite':'qualified')}),t(j?'eliteThreshold':'qualifiedThreshold')+': '+number(ref[j])));
  }
  for(const [j,v] of vals.entries())plot.append(marker(svg('circle',{cx:x(v),cy:20+(j%4)*8,r:3,class:'sample'}),number(v)));
  fig.append(plot,properties([[t('minScore'),number(vals[0])],[t('maxScore'),number(vals.at(-1))]]));
  if(ref.some(Number.isFinite))fig.append(properties([[t('qualifiedThreshold'),number(ref[0])],[t('eliteThreshold'),number(ref[1])]]));
  return fig;
}
function sourcePanel(row){
  const latest=take(row.revisions).at(-1);
  const content=node('div',undefined,'candidate-content');
  content.append(properties([[t('candidate'),row.id],[t('researchRole'),row.role],[t('operator'),t(row.operation==='seed'?'seedOp':row.operation||'empty')]]));
  if(latest)content.append(properties([[t('hypothesis'),latest.hypothesis],[t('formula'),latest.formula]]));
  if(row.coverage)content.append(properties([[t('testedPeriods'),number(row.coverage.periods,0)],[t('miPeriods'),number(row.coverage.miPeriods,0)],[t('missingValues'),Number.isFinite(row.coverage.missing)?new Intl.NumberFormat(lang,{style:'percent',maximumFractionDigits:2}).format(row.coverage.missing):'—']]));
  const parentLinks=node('div',undefined,'actions');
  for(const id of take(row.parents)){
    const parentGen=take(active.generations).find(g=>take(g.rows).some(x=>x.id===id));
    if(!parentGen){parentLinks.append(node('span',id,'tag'));continue;}
    const b=node('button',id,'tag');b.type='button';b.onclick=()=>{generation=parentGen.index;candidate=id;render();$('candidate-result')?.focus();};parentLinks.append(b);
  }
  if(parentLinks.childNodes.length)content.append(node('h3',t('lineage')),parentLinks);
  for(const [i,revision] of take(row.revisions).entries()){
    const pre=node('pre',revision.code);
    content.append(detailPanel(t('code')+' '+number(i+1,0)+(revision.stage?' · '+revision.stage:''),pre));
  }
  if(take(row.reviews).length){
    const reports=table([t('stage'),t('status'),t('reason')],row.reviews.map(x=>[x.stage,state(x.pass?'passed':'failed',x.pass?'completed':'failed'),x.reason]));
    content.append(node('h3',t('reviews')),reports);
  }
  const result=panel(latest?.name||row.id,content,'candidate-result');
  result.id='candidate-result';result.tabIndex=-1;return result;
}
function strategyReport(strategies,runId){
  const all=node('div',undefined,'strategy-list');
  for(const item of Object.values(strategies)){
    const sec=node('article',undefined,'panel strategy');
    const header=node('div',undefined,'section-heading');
    header.append(node('h3',item.plan?.title||item.id),state('strategy_'+item.status,item.status));
    if(item.bundle)header.append(link(t('strategyDownload'),runUrl(runId)+'/strategies?download='+encodeURIComponent(item.id),'button secondary'));
    sec.append(header,properties([[t('strategyBacktestTarget'),targets.get(item.target)||item.target],[t('strategyBacktestStart'),date(item.start)],[t('strategyBacktestEnd'),date(item.end)],[t('strategyBrief'),item.brief||'—']]));
    if(item.error)sec.append(node('p',t(item.error),'problem'));
    const metrics=item.bundle?.backtest?.metrics;
    if(metrics){
      const stats=node('div',undefined,'stat-grid');
      stats.append(stat(t('strategyFills'),number(metrics.filledOrders,0)),stat(t('orders'),number(metrics.orders,0)),stat(t('positions'),number(metrics.positions,0)),stat(t('simulatedEvents'),number(metrics.iterations,0)));
      sec.append(node('h4',t('strategyBacktestMetrics')),stats);
      for(const [key,label] of [['pnl','pnl'],['returns','returns']]){
        const section=metrics[key];
        if(!section||typeof section!=='object'||!Object.keys(section).length)continue;
        const flat=Object.entries(section).flatMap(([k,v])=>v&&typeof v==='object'?Object.entries(v).map(([sub,value])=>[k+' · '+sub,number(value)]):[[k,number(v)]]);
        sec.append(detailPanel(t(label),table([t('statistic'),t('value')],flat)));
      }
      if(take(item.bundle.sourceCandidates).length)sec.append(properties([[t('sourceFactors'),item.bundle.sourceCandidates.join(' · ')]]));
      if(item.bundle.plan?.source)sec.append(detailPanel(t('code'),node('pre',item.bundle.plan.source)));
    }
    const ops=Object.entries(item.deployments||{});
    if(ops.length)sec.append(node('h4',t('deploymentReceipts')),table([t('strategyDeployTarget'),t('status'),t('instance'),t('reason')],ops.map(([id,op])=>[
      targets.get(id)||id,state('strategy_'+op.status,op.status),op.receipt?.instance,t(op.error||'—'),
    ])));
    all.append(sec);
  }
  return all;
}
function render(){
  if(!active)return;
  const r=active;
  const generations=take(r.generations);
  const output=[];
  const head=mast(t('report'),runTitle(r));
  const meta=node('div',undefined,'mast-meta');
  meta.append(state(r.status),node('span',date(r.created),'subtitle'));
  if(generations.length)meta.append(link(t('export'),runUrl(r.id)+'/export','button secondary'));
  head.append(meta);output.push(head);
  if(r.error)output.push(node('p',t(r.error),'problem'));
  const cov=r.coverage;
  const stats=node('div',undefined,'stat-grid');
  stats.append(stat(t('assetCount'),number(cov?.instruments,0)),stat(t('observedMinutes'),number(cov?.observedMinutes,0),cov?.expectedMinutes!=null?t('expectedMinutes')+': '+number(cov.expectedMinutes,0):null),stat(t('rows'),number(cov?.rows,0)),stat(t('generations'),number(generations.length,0)));
  output.push(stats);
  if(r.progress?.total>0&&onAir.has(r.status)){
    const progress=node('progress');progress.max=r.progress.total;progress.value=r.progress.completed;
    progress.setAttribute('aria-label',t('generationProgress'));
    const info=node('div',undefined,'run-progress');
    info.append(node('span',t('generation')+' '+number(r.current,0)+' · '+number(r.progress.completed,0)+' / '+number(r.progress.total,0)),progress);
    output.push(info);
  }
  const input=r.input||{};
  const settings=properties([[t('model'),r.model],[t('thinking'),r.thinking],[t('speed'),r.speed==='priority'?'Fast':r.speed==='default'?'Standard':t('providerDefault')],
    [t('horizon'),number(input.horizon,0)],[t('startDate'),date(input.start)],[t('endExclusive'),date(input.end)],[t('sourceBars'),input.barSpec],
    ...(cov?[[t('firstBar'),cov.from],[t('lastBar'),cov.through]]:[]),
    ...(r.stopReason?[[t('runStopReason'),t(r.stopReason==='limit'?'limit':r.stopReason)]]:[]),
    [t('runId'),r.id]]);
  if(input.direction)settings.append(properties([[t('direction'),input.direction]]));
  output.push(detailPanel(t('researchParameters'),settings));
  if(generations.length){
    output.push(panel(t('generationProgress'),generationChart(generations)));
    const current=generations.find(g=>g.index===generation)||generations.at(-1);
    const sel=node('select');sel.setAttribute('aria-label',t('generation'));
    sel.append(...generations.map(g=>makeOption(g.index,t('generation')+' '+number(g.index,0))));
    sel.value=current.index;
    sel.onchange=()=>{generation=Number(sel.value);candidate=undefined;render();$('generationPicker')?.focus();};
    sel.id='generationPicker';
    const chartHeader=node('div',undefined,'section-heading');
    chartHeader.append(node('h2',t('scores')),sel);
    const score=node('section',undefined,'panel');
    const plots=node('div',undefined,'distributions');
    plots.append(...take(current.keys).map(k=>distribution(current,k)));
    score.append(chartHeader,plots);output.push(score);
    if(current.feedback?.notes)output.push(panel(t('feedback'),node('p',current.feedback.notes,'report-prose')));
    if(take(current.rows).length){
      const rows=current.rows.map(c=>{
        const b=node('button',take(c.revisions).at(-1)?.name||c.id,'record');
        b.type='button';b.onclick=()=>{candidate=c.id;render();$('candidate-result')?.focus();};
        if(c.id===candidate)b.setAttribute('aria-pressed','true');
        const status=c.failure?state(c.failure,'failed'):current.elites.includes(c.id)?state('elite'):current.parents.includes(c.id)?state('retainedParents','qualified'):Number.isFinite(c.scores?.ic)?state('evaluated','evaluated'):state('noScores','');
        return [b,status,...take(current.keys).map(k=>number(c.scores?.[k]))];
      });
      output.push(panel(t('candidates'),table([t('candidate'),t('status'),...take(current.keys).map(lookup)],rows),'table-panel'));
    }
    const focus=take(current.rows).find(c=>c.id===candidate);
    if(focus)output.push(sourcePanel(focus));
  }else output.push(blank(t('noGenerations')));
  if(Object.keys(r.strategies||{}).length){
    output.push(node('h2',t('strategyDelivery'),'standalone-title'),strategyReport(r.strategies,r.id));
  }
  const el=$('detail');
  // Keep disclosure and focus state across incoming snapshots.
  const previousFocus=document.activeElement;
  const priorControls=[...el.querySelectorAll('a,button,select,summary,[tabindex]')];
  const focusIndex=priorControls.indexOf(previousFocus);
  const expanded=[...el.querySelectorAll('details[open] > summary')].map(s=>s.textContent);
  el.replaceChildren(...output);
  for(const details of el.querySelectorAll('details'))details.open=expanded.includes(details.firstChild.textContent);
  if(focusIndex>=0){
    const nextControl=el.querySelectorAll('a,button,select,summary,[tabindex]')[focusIndex];
    if(nextControl?.tagName===previousFocus.tagName&&nextControl.textContent===previousFocus.textContent)
      nextControl.focus({preventScroll:true});
  }
}
function localize(){
  document.documentElement.lang=lang;
  for(const el of document.querySelectorAll('[data-i]'))el.textContent=t(el.dataset.i);
  $('lang').value=lang;
  err(errorCode);drawRuns();
  if(view==='overview')overview();else if(view==='run')render();else if(view==='performance')renderReview();else if(view==='settings')settings.localize();
}
$('lang').onchange=e=>{lang=e.target.value;localStorage.setItem('alpha.locale',lang);localize();};
document.querySelector('.skip').onclick=e=>{e.preventDefault();$('main').focus();};
window.addEventListener('hashchange',route);
localize();route();void refreshRuns();
void api('/strategy-targets').then(data=>updateTargets(take(data.targets))).catch(()=>{});
setInterval(()=>{if(!document.hidden)void refreshRuns();},25000);
