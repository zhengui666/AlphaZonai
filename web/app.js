import {packs} from './locale.js';

const $=id=>document.getElementById(id);
const defaultsForm=$('modelDefaultsForm'),keyForm=$('modelKeyForm');
let lang=Object.hasOwn(packs,localStorage.getItem('alpha.locale'))?localStorage.getItem('alpha.locale'):'en';
let runs=[],loaded=false,list=[],active,stream,selectedId,candidate,generation,errorCode,modelSettings,chatGPTPoll,view,routeVersion=0;
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
async function api(path){
  const r=await fetch('/api'+path);const payload=await r.json();
  if(!r.ok)throw Error(payload.error||'SERVER_ERROR');return payload;
}
async function updateModelSettings(body){
  const r=await fetch('/api/model-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const payload=await r.json();if(!r.ok)throw Error(payload.error||'SERVER_ERROR');return payload;
}
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
  for(const [id,mode] of [['overviewLink','overview'],['modelSettingsButton','models']]){
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
  const id=hash.replace(/^run\//,'');
  const prior=selectedId;
  selectedId=/^[0-9a-f-]{36}$/i.test(id)?id:undefined;
  view=selectedId?'run':hash==='models'?'models':'overview';
  stream?.close();stream=undefined;err();
  $('overview').hidden=view!=='overview';$('detail').hidden=view!=='run';$('modelSettings').hidden=view!=='models';
  if(prior!==selectedId){active=undefined;candidate=undefined;generation=undefined;}
  drawRuns();
  if(view==='run')void open(selectedId,version);
  else if(view==='models')loadModels(true).catch(e=>err(e.message));
  else overview();
}

function svg(tag,attrs={}){
  const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);
  return el;
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
const modelKey=x=>(x.provider||'openai')+':'+(x.id||x.model);
function setupModel(target,preferred){
  const current=list.find(x=>modelKey(x)===target.elements.model.value);
  const levels=current?.thinking||['off'], speeds=current?.speed||[];
  const effort=preferred?.thinking??target.elements.thinking.value;
  const speed=preferred?.speed??target.elements.speed.value;
  target.elements.thinking.replaceChildren(...levels.map(k=>makeOption(k,k.slice(0,1).toUpperCase()+k.slice(1))));
  if(levels.includes(effort))target.elements.thinking.value=effort;
  target.elements.speed.replaceChildren(makeOption('',t('providerDefault')),...speeds.map(k=>makeOption(k,k==='priority'?'Fast':'Standard')));
  if(speeds.includes(speed))target.elements.speed.value=speed;
  target.elements.speed.disabled=speeds.length===0;
}
function showModels(preferDefaults){
  const pref=modelSettings?.defaults;
  for(const target of [defaultsForm]){
    const old=target.elements.model.value;
    target.elements.model.replaceChildren(...list.map(x=>makeOption(modelKey(x),(x.name||x.id)+' / '+(x.provider==='openai-codex'?'ChatGPT':'OpenAI API'))));
    const prefKey=pref?.model?modelKey(pref):'';
    const id=preferDefaults&&prefKey?prefKey:old||prefKey;
    if(list.some(m=>modelKey(m)===id))target.elements.model.value=id;
    setupModel(target,preferDefaults&&prefKey===target.elements.model.value?pref:undefined);
  }
  $('modelConnection').textContent=t(modelSettings?.connected?'modelConnected':'modelDisconnected');
  $('modelSettingsNotice').hidden=Boolean(modelSettings?.writable);
  keyForm.elements.key.disabled=!modelSettings?.writable;
  keyForm.querySelector('[type=submit]').disabled=!modelSettings?.writable;
  $('disconnectModel').disabled=!modelSettings?.writable||!modelSettings?.stored;
  defaultsForm.querySelector('[type=submit]').disabled=!modelSettings?.writable||!list.length;
  showChatGPT();
}
function showChatGPT(){
  const local=modelSettings?.writable, connected=modelSettings?.chatGPTConnected, login=modelSettings?.chatGPT;
  $('chatGPTActions').hidden=!local;
  const pending=['starting','waiting'].includes(login?.status);
  $('chatGPTStart').hidden=pending||connected;
  $('chatGPTCancel').hidden=!pending;
  $('chatGPTDisconnect').hidden=!connected;
  $('chatGPTStatus').textContent=connected?t('chatGPTConnected'):login?.status==='failed'?t('chatGPTFailed'):'';
  const code=login?.status==='waiting'?login.code:'';
  $('chatGPTDevice').hidden=!code;
  if(code){$('chatGPTCode').textContent=code;$('chatGPTLink').href=login.url;}
  else {$('chatGPTCode').textContent='';$('chatGPTLink').removeAttribute('href');}
  if(pending&&!chatGPTPoll){
    chatGPTPoll=setTimeout(()=>{chatGPTPoll=undefined;loadModels(false).catch(e=>err(e.message));},2500);
  }else if(!pending&&chatGPTPoll){clearTimeout(chatGPTPoll);chatGPTPoll=undefined;}
}
async function loadModels(preferDefaults){
  modelSettings=await api('/model-settings');
  list=modelSettings.models;
  showModels(preferDefaults);
}
async function saveModelSettings(value,formElement){
  if(formElement.dataset.saving||!modelSettings?.writable)return;
  formElement.dataset.saving='1';
  err();
  try{
    modelSettings=await updateModelSettings(value);
    list=modelSettings.models;
    showModels(true);
    if(value.action==='defaults')$('modelConnection').textContent=t('modelSaved');
  }catch(e){err(e.message);}
  finally{delete formElement.dataset.saving;}
}
keyForm.onsubmit=e=>{
  e.preventDefault();
  if(keyForm.dataset.saving||!modelSettings?.writable)return;
  const key=keyForm.elements.key.value;keyForm.elements.key.value='';
  void saveModelSettings({action:'connect',key},keyForm);
};
$('disconnectModel').onclick=()=>saveModelSettings({action:'disconnect'},keyForm);
$('chatGPTStart').onclick=()=>saveModelSettings({action:'chatgpt-start'},keyForm);
$('chatGPTCancel').onclick=()=>saveModelSettings({action:'chatgpt-cancel'},keyForm);
$('chatGPTDisconnect').onclick=()=>saveModelSettings({action:'chatgpt-disconnect'},keyForm);
$('refreshModels').onclick=()=>loadModels(true).catch(e=>err(e.message));
defaultsForm.onsubmit=e=>{
  e.preventDefault();
  if(!modelSettings?.writable)return;
  const {model,thinking,speed}=defaultsForm.elements;
  const selected=list.find(x=>modelKey(x)===model.value);
  if(!selected)return;
  void saveModelSettings({action:'defaults',model:selected.id,provider:selected.provider,thinking:thinking.value,speed:speed.value||null},defaultsForm);
};

defaultsForm.elements.model.onchange=()=>setupModel(defaultsForm);
function localize(){
  document.documentElement.lang=lang;
  for(const el of document.querySelectorAll('[data-i]'))el.textContent=t(el.dataset.i);
  $('lang').value=lang;
  err(errorCode);drawRuns();
  if(view==='overview')overview();else if(view==='run')render();else if(view==='models'&&modelSettings)showModels(false);
}
$('lang').onchange=e=>{lang=e.target.value;localStorage.setItem('alpha.locale',lang);localize();};
document.querySelector('.skip').onclick=e=>{e.preventDefault();$('main').focus();};
window.addEventListener('hashchange',route);
localize();route();void refreshRuns();
void api('/strategy-targets').then(data=>{
  for(const target of take(data.targets))targets.set(target.id,target.label);
  if(view==='run')render();
}).catch(()=>{});
setInterval(()=>{if(!document.hidden)void refreshRuns();},25000);
