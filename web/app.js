import {packs} from './locale.js';
const $=id=>document.getElementById(id);
const form=$('form'),defaultsForm=$('modelDefaultsForm'),keyForm=$('modelKeyForm');
let lang=Object.hasOwn(packs,localStorage.getItem('alpha.locale'))?localStorage.getItem('alpha.locale'):'en';
let runs=[],list=[],active,stream,selectedId,candidate,generation,errorCode,modelSettings,chatGPTPoll;
const t=k=>packs[lang][k]||packs.en[k]||k;
const node=(name,text,cls)=>{const e=document.createElement(name);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const format=v=>v==null?'—':typeof v==='number'?Intl.NumberFormat(lang,{maximumFractionDigits:5}).format(v):v;
const btn=(k,fn,cls)=>{const b=node('button',t(k),cls);b.type='button';b.onclick=fn;return b;};
function err(code){errorCode=code;$('error').hidden=!code;$('error').textContent=code?t(code):'';}
async function api(path,body){
  const r=await fetch('/api'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  const j=await r.json();if(!r.ok)throw Error(j.error||'SERVER_ERROR');return j;
}
function refreshRuns(){api('/runs').then(r=>{runs=r;drawRuns();}).catch(e=>err(e.message));}
function drawRuns(){
  $('runs').replaceChildren(...runs.map(r=>{
    const b=btn(r.preset,()=>open(r.id),r.id===selectedId?'selected':'');
    b.append(node('small',t(r.status)+' · '+new Date(r.created).toLocaleDateString(lang)));
    return b;
  }));
}
function home(){selectedId=undefined;active=undefined;stream?.close();location.hash='';err();$('modelSettings').hidden=true;$('create').hidden=false;$('detail').hidden=true;drawRuns();}
async function open(id){
  stream?.close();selectedId=id;active=undefined;generation=undefined;candidate=undefined;err();location.hash=id;
  try{
    const r=await api('/runs/'+id);if(selectedId!==id)return;active=r;render();
    stream=new EventSource('/api/runs/'+id+'/events');
    stream.onmessage=e=>{if(selectedId!==id)return;active=JSON.parse(e.data);render();const i=runs.findIndex(r=>r.id===id);if(i>=0){runs[i].status=active.status;drawRuns();}};
  }catch(e){err(e.message);}
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
  for(const target of [form,defaultsForm]){
    const old=target.elements.model.value;
    target.elements.model.replaceChildren(...list.map(x=>makeOption(modelKey(x),(x.name||x.id)+' / '+(x.provider==='openai-codex'?'ChatGPT':'OpenAI API'))));
    const prefKey=pref?.model?modelKey(pref):'';
    const id=preferDefaults&&prefKey?prefKey:old||prefKey;
    if(list.some(m=>modelKey(m)===id))target.elements.model.value=id;
    setupModel(target,preferDefaults&&prefKey===target.elements.model.value?pref:undefined);
  }
  $('modelConnection').textContent=t(modelSettings?.connected?'modelConnected':'modelDisconnected');
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
  if(formElement.dataset.saving)return;
  formElement.dataset.saving='1';
  err();
  try{
    modelSettings=await api('/model-settings',value);
    list=modelSettings.models;
    showModels(true);
    if(value.action==='defaults')$('modelConnection').textContent=t('modelSaved');
  }catch(e){err(e.message);}
  finally{delete formElement.dataset.saving;}
}
$('modelSettingsButton').onclick=()=>{
  selectedId=undefined;active=undefined;stream?.close();location.hash='';
  $('create').hidden=true;$('detail').hidden=true;$('modelSettings').hidden=false;
  err();drawRuns();loadModels(true).catch(e=>err(e.message));
};
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
function makeOption(value,title){const o=node('option',title);o.value=value;return o;}
function stylePreset(){for(const e of document.querySelectorAll('.tunable'))e.hidden=form.elements.preset.value==='paper';}
form.elements.model.onchange=()=>setupModel(form);defaultsForm.elements.model.onchange=()=>setupModel(defaultsForm);form.elements.preset.onchange=stylePreset;
loadModels(true).catch(e=>err(e.message));
form.onsubmit=async e=>{
  e.preventDefault();err();
  const payload=Object.fromEntries(new FormData(form));payload.id=crypto.randomUUID();
  const selected=list.find(x=>modelKey(x)===payload.model);
  if(!selected){err('MODEL_CREDENTIAL');return;}
  payload.model=selected.id;payload.provider=selected.provider;
  const b=form.querySelector('button[type=submit]');b.disabled=true;
  try{const r=await api('/runs',payload);refreshRuns();await open(r.id);}catch(e){err(e.message);}finally{b.disabled=false;}
};
function chart(g,k){
  const vals=g.rows.map(r=>r.scores?.[k]).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!vals.length)return node('div',k.toUpperCase()+' · —','mini');
  const lo=vals[0], hi=vals.at(-1), width=220,height=88;
  const x=(v)=>12+(v-lo)/(hi-lo||1)*(width-24);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 '+width+' '+height);svg.setAttribute('aria-label',k.toUpperCase());
  const make=(tag,a)=>{const s=document.createElementNS(svg.namespaceURI,tag);for(const [k,v] of Object.entries(a))s.setAttribute(k,v);svg.append(s);};
  for(const [i,v] of vals.entries())make('circle',{cx:x(v),cy:73-i/Math.max(1,vals.length-1)*57,r:2.5,fill:'#b5573b'});
  for(const [v,col] of [[g.qualified[g.keys.indexOf(k)],'#9d9486'],[g.elite[g.keys.indexOf(k)],'#69482a']])if(Number.isFinite(v))make('line',{x1:x(v),x2:x(v),y1:8,y2:80,stroke:col,'stroke-dasharray':'3 3'});
  const out=node('figure',undefined,'mini');out.append(node('figcaption',k.toUpperCase()),svg,node('small',format(lo)+'  ·  '+format(hi)));return out;
}
function render(){
  if(!active)return;
  $('modelSettings').hidden=true;$('create').hidden=true;$('detail').hidden=false;
  const r=active;const h=node('div',undefined,'heading');const title=node('div');title.append(node('h1',t(r.preset)),node('span',t(r.status),'pill'));h.append(title);
  const controls=node('div',undefined,'actions');for(const [verb,statuses] of [['pause',['queued','running']],['resume',['pausing','paused']],['stop',['queued','running','pausing','paused']]]){
    if(statuses.includes(r.status))controls.append(btn(verb,()=>api('/runs/'+r.id+'/actions',{action:verb}).catch(e=>err(e.message))));
  }
  const exportLink=node('a',t('export'),'button');exportLink.href='/api/runs/'+r.id+'/export';controls.append(exportLink);h.append(controls);
  const out=[h];
  if(r.error)out.push(node('p',t(r.error),'problem'));
  const p=r.progress;if(p)out.push(node('div',t('generation')+' '+r.current+'/'+r.limit+' · '+p.completed+'/'+p.total,'muted'));
  const c=r.coverage;if(c)out.push(node('div',[[t('assetCount'),c.instruments],[t('observedMinutes'),c.observedMinutes],[t('expectedMinutes'),c.expectedMinutes],[t('rows'),c.rows]].map(([k,v])=>k+' '+format(v)).join(' · '),'muted'));
  if(!r.generations.length){$('detail').replaceChildren(...out);return;}
  const gs=node('select');gs.setAttribute('aria-label',t('generation'));gs.append(...r.generations.map(g=>makeOption(g.index,t('generation')+' '+g.index)));
  const g=r.generations.find(x=>x.index===generation)||r.generations.at(-1);gs.value=g.index;gs.onchange=()=>{generation=Number(gs.value);candidate=undefined;render();};out.push(gs);
  const plots=node('div',undefined,'plots');plots.append(...g.keys.map(k=>chart(g,k)));out.push(plots);
  const table=node('table'),head=node('thead'),tr=node('tr');
  for(const name of [t('candidate'),t('operator'),t('status'),...g.keys.map(k=>k.toUpperCase())])tr.append(node('th',name));head.append(tr);table.append(head);
  const tbody=node('tbody');for(const x of g.rows){
    const tr=node('tr');const td=node('td');td.append(btn(x.id,()=>{candidate=x.id;render();}));tr.append(td);
    tr.append(node('td',t(x.operation==='seed'?'seedOp':x.operation||'empty')),node('td',x.failure?t(x.failure):g.elites.includes(x.id)?t('elite'):g.parents.includes(x.id)?t('qualified'):'—'));
    for(const k of g.keys)tr.append(node('td',format(x.scores?.[k])));
    tbody.append(tr);
  }table.append(tbody);const scroll=node('div',undefined,'scroll');scroll.append(table);out.push(scroll);
  const focus=g.rows.find(x=>x.id===candidate);
  if(focus){
    const panel=node('section',undefined,'panel');panel.append(node('h2',focus.revisions.at(-1)?.name||focus.id),node('h3',t('lineage')));
    const parents=node('div',undefined,'actions');
    for(const id of focus.parents)parents.append(btn(id,()=>{generation=Number(id.split('.')[0]);candidate=id;render();}));
    if(!focus.parents.length)parents.append(node('span','—'));
    panel.append(parents);
    if(focus.revisions.length){
      const code=node('pre',focus.revisions.at(-1).code);panel.append(node('h3',t('code')),code);
      if(focus.revisions.length>1){
        const before=focus.revisions.at(-2).code.split('\n'),after=focus.revisions.at(-1).code.split('\n');
        const diff=before.filter((line,i)=>line!==after[i]).map(x=>'- '+x).concat(after.filter((line,i)=>line!==before[i]).map(x=>'+ '+x));panel.append(node('h3',t('diff')),node('pre',diff.join('\n')));
      }
    }
    if(focus.reviews.length){panel.append(node('h3',t('reviews')));for(const review of focus.reviews)panel.append(node('div',(review.pass?'✓ ':'× ')+review.stage+' · '+review.reason));}
    out.push(panel);
  }
  $('detail').replaceChildren(...out);
}
function localize(){
  document.documentElement.lang=lang;
  for(const e of document.querySelectorAll('[data-i]'))e.textContent=t(e.dataset.i);
  $('new').textContent='+ '+t('newRun');$('lang').value=lang;err(errorCode);if(modelSettings)showModels(false);drawRuns();render();
}
$('lang').onchange=e=>{lang=e.target.value;localStorage.setItem('alpha.locale',lang);localize();};
$('new').onclick=home;
localize();stylePreset();refreshRuns();if(/^[0-9a-f-]{36}$/.test(location.hash.slice(1)))open(location.hash.slice(1));
