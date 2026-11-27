const $=id=>document.getElementById(id);
const modelKey=m=>m.provider+':'+(m.id||m.model);

export function settingsPatch(previous,values,token,clearToken){
  const patch={};
  for(const [key,value] of Object.entries(values)){
    if(JSON.stringify(value)!==JSON.stringify(previous[key]))patch[key]=value;
  }
  if(token&&(clearToken||token.value.trim()))patch[token.name]=clearToken?'':token.value;
  return patch;
}

export function settingsPage({t,makeOption,api,updateTargets}){
  const keyForm=$('modelKeyForm'),defaults=$('modelDefaultsForm');
  const forms={nautilus:$('nautilusForm'),review:$('reviewForm'),data:$('dataForm')};
  const initial={},nav=$('settingsNav').querySelectorAll('a');
  let section,settings,poll,visit=0,modelRequest=0;

  function message(id,code,isError=false){
    const el=$(id);
    el.hidden=!code;el.className=isError?'problem':'subtle';
    el.dataset.i=code||'';el.textContent=code?t(code):'';
  }
  function panels(){
    for(const a of nav){
      const name=a.hash.split('/')[1]||'model',active=name===section;
      if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
      $('settings-'+name).hidden=!active||!settings?.writable;
    }
  }
  function addTarget(value={}){
    const row=$('targetTemplate').content.firstElementChild.cloneNode(true),f=row.elements;
    for(const el of row.querySelectorAll('[data-i]'))el.textContent=t(el.dataset.i);
    for(const name of ['id','label','kind','profile','alias','sshConfig','marketContext']){
      if(value[name]!==undefined)f[name].value=value[name];
    }
    if(value.roles)f.role.value=value.roles.includes('backtest')&&value.roles.includes('deploy')?'both':value.roles[0];
    function showConnection(){
      for(const name of ['profile','alias','sshConfig']){
        const hidden=name==='profile'?f.kind.value!=='local':f.kind.value!=='ssh';
        f[name].disabled=hidden;f[name].closest('label').hidden=hidden;
      }
    }
    showConnection();f.kind.onchange=showConnection;
    row.querySelector('button').onclick=()=>{row.remove();$('addTarget').focus();};
    $('targetList').append(row);
    return row;
  }
  $('addTarget').onclick=()=>addTarget().elements.id.focus();
  function targetValues(row){
    const f=row.elements,kind=f.kind.value;
    const roles=f.role.value==='both'?['backtest','deploy']:[f.role.value];
    const target={id:f.id.value,label:f.label.value,kind,roles};
    if(kind==='local')target.profile=f.profile.value;
    else {target.alias=f.alias.value;target.sshConfig=f.sshConfig.value;}
    if(f.marketContext.value)target.marketContext=f.marketContext.value;
    return target;
  }
  function values(name){
    const f=forms[name].elements;
    if(name==='nautilus')return {python:f.python.value,targets:Array.from($('targetList').children,targetValues)};
    if(name==='review')return {enabled:f.enabled.checked,time:f.time.value,language:f.language.value,objective:f.objective.value};
    return {catalog:f.catalog.value,stateDir:f.stateDir.value,host:f.host.value,port:f.port.valueAsNumber};
  }
  function tokenLabel(name){
    const form=forms[name],token=form.querySelector('input[type=password]');
    const configured=settings[name][token.name+'Configured'];
    token.placeholder=t(configured?'tokenSaved':'tokenUnset');
    form.elements.clearToken.closest('label').hidden=!configured;
  }
  function fillForm(name){
    const form=forms[name],saved=settings[name];
    for(const [key,value] of Object.entries(saved)){
      const field=form.elements.namedItem(key);
      if(!field)continue;
      if(field.type==='checkbox')field.checked=value;else field.value=value;
    }
    if(name==='nautilus'){
      $('targetList').replaceChildren();saved.targets.forEach(addTarget);updateTargets(saved.targets);
    }
    const token=form.querySelector('input[type=password]');
    if(token){
      form.elements.clearToken.checked=false;token.value='';token.disabled=false;tokenLabel(name);
    }
    initial[name]=values(name);
  }
  function modelOptions(preference){
    const f=defaults.elements;
    const current=settings.model.models.find(m=>modelKey(m)===f.model.value);
    const levels=current?.thinking||['off'],speeds=current?.speed||[];
    const effort=preference?.thinking??f.thinking.value,speed=preference?preference.speed:f.speed.value;
    f.thinking.replaceChildren(...levels.map(k=>makeOption(k,k.slice(0,1).toUpperCase()+k.slice(1))));
    if(levels.includes(effort))f.thinking.value=effort;
    f.speed.replaceChildren(makeOption('',t('providerDefault')),...speeds.map(k=>makeOption(k,k==='priority'?'Fast':'Standard')));
    if(speeds.includes(speed))f.speed.value=speed;
    f.speed.disabled=!speeds.length;
  }
  function showModel(preferSaved){
    const model=settings.model,{models,chatGPT:login}=model,select=defaults.elements.model;
    const saved=model.defaults&&modelKey(model.defaults),old=select.value;
    select.replaceChildren(...models.map(m=>makeOption(modelKey(m),(m.name||m.id)+' / '+(m.provider==='openai-codex'?'ChatGPT':'OpenAI API'))));
    const preferred=preferSaved?saved:old||saved;
    if(models.some(m=>modelKey(m)===preferred))select.value=preferred;
    modelOptions(preferSaved&&select.value===saved?model.defaults:undefined);
    defaults.querySelector('[type=submit]').disabled=!models.length;
    $('modelConnection').textContent=t(model.connected?'modelConnected':'modelDisconnected');
    $('disconnectModel').disabled=!model.connected;
    const pending=['starting','waiting'].includes(login?.status),code=login?.status==='waiting'?login.code:'';
    $('chatGPTStart').hidden=pending||model.chatGPTConnected;
    $('chatGPTCancel').hidden=!pending;$('chatGPTDisconnect').hidden=!model.chatGPTConnected;
    $('chatGPTStatus').textContent=model.chatGPTConnected?t('chatGPTConnected'):login?.status==='failed'?t('chatGPTFailed'):'';
    $('chatGPTDevice').hidden=!code;$('chatGPTCode').textContent=code;
    if(code)$('chatGPTLink').href=login.url;else $('chatGPTLink').removeAttribute('href');
    clearTimeout(poll);
    if(pending&&section==='model')poll=setTimeout(()=>refreshModel(false),2500);
  }
  async function refreshModel(preferSaved){
    const request=++modelRequest;
    try{
      const result=await api('/settings');
      if(request!==modelRequest||section!=='model')return;
      settings.model=result.model;showModel(preferSaved);
    }catch(e){if(request===modelRequest)message('settingsFeedback',e.message,true);}
  }

  async function save(name,body){
    const pane=$('settings-'+name),current=visit;
    if(!settings?.writable||pane.inert)return;
    pane.inert=true;message('settingsFeedback','settingsSaving');
    if(name==='model'){++modelRequest;clearTimeout(poll);}
    try{
      const result=await api('/settings/'+name,body);
      if(current!==visit)return;
      settings[name]=result[name];
      if(name==='model')showModel(body.action==='defaults');else fillForm(name);
      if(section===name)message('settingsFeedback',name!=='model'?'settingsSaved':body.action==='defaults'?'modelSaved':null);
    }catch(e){if(current===visit&&section===name)message('settingsFeedback',e.message,true);}
    finally{pane.inert=false;}
  }
  keyForm.onsubmit=e=>{
    e.preventDefault();
    const key=keyForm.elements.key.value;keyForm.elements.key.value='';
    void save('model',{action:'connect',key});
  };
  for(const [id,action] of [['disconnectModel','disconnect'],['chatGPTStart','chatgpt-start'],['chatGPTCancel','chatgpt-cancel'],['chatGPTDisconnect','chatgpt-disconnect']]){
    $(id).onclick=()=>save('model',{action});
  }
  $('refreshModels').onclick=()=>refreshModel(true);
  defaults.elements.model.onchange=()=>modelOptions();
  defaults.onsubmit=e=>{
    e.preventDefault();
    const f=defaults.elements,selected=settings.model.models.find(m=>modelKey(m)===f.model.value);
    if(selected)void save('model',{action:'defaults',model:selected.id,provider:selected.provider,thinking:f.thinking.value,speed:f.speed.value||null});
  };
  for(const [name,form] of Object.entries(forms)){
    const token=form.querySelector('input[type=password]'),clear=form.elements.clearToken;
    if(clear)clear.onchange=()=>{token.disabled=clear.checked;};
    form.onsubmit=e=>{
      e.preventDefault();
      const patch=settingsPatch(initial[name],values(name),token,clear?.checked);
      if(Object.keys(patch).length)void save(name,patch);else message('settingsFeedback','settingsSaved');
    };
  }
  return {
    async open(name){
      const entering=!section;
      section=name;panels();message('settingsFeedback');clearTimeout(poll);
      if(!entering&&settings){if(settings.writable&&section==='model')showModel(false);return;}
      const current=++visit;message('settingsNotice','loading');
      try{
        const result=await api('/settings');
        if(current!==visit)return;
        settings=result;
        message('settingsNotice',settings.writable?null:'SETTINGS_LOCAL',!settings.writable);
        if(settings.writable){
          keyForm.elements.key.value='';showModel(true);
          for(const group of Object.keys(forms))fillForm(group);
        }
        panels();
      }catch(e){if(current===visit)message('settingsNotice',e.message,true);}
    },
    close(){
      if(!section)return;
      section=settings=undefined;++visit;++modelRequest;clearTimeout(poll);
    },
    localize(){
      if(!settings?.writable)return;
      showModel(false);tokenLabel('nautilus');tokenLabel('data');
    },
  };
}
