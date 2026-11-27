const lastReview=new Map();

export function reviewPath(mode,id,reference=''){
  return '#performance/'+mode+(id?'/'+encodeURIComponent(id):'')+(reference?'?ref='+encodeURIComponent(reference):'');
}
export function reviewRoute(hash){
  const match=hash.match(/^performance(?:\/(paper|live)(?:\/([0-9a-f-]{36})(?:\?ref=(.*))?)?)?$/);
  if(!match)return;
  const reference=new URLSearchParams(match[3]?'ref='+match[3]:'').get('ref')||'';
  const parts=reference.split('/').map(part=>{try{return decodeURIComponent(part);}catch{return part;}});
  return {mode:match[1]||'paper',id:match[2],parts};
}
export function reviewLabel(job,t,utc){
  return [job.trigger==='daily'?t('dailyReview'):t('manualReview'),
    job.trigger==='daily'?job.period.date:utc(job.created)+' UTC',t('review_'+job.status)].join(' · ');
}
export function aiReview(mode,report,reports,ui,signal){
  const {lang,t,node,link,detailPanel,properties,makeOption,api,utc}=ui;
  const base='/performance/reviews';
  const section=node('section',undefined,'panel ai-review'),form=node('form',undefined,'review-form');
  const heading=node('div',undefined,'section-heading'),history=node('select');
  history.hidden=true;history.setAttribute('aria-label',t('reviewHistory'));
  heading.append(node('h2',t('aiReview')),history);
  const schedule=node('div',undefined,'daily-schedule'),manual=detailPanel(t('manualReview'),form);
  schedule.setAttribute('role','status');manual.hidden=true;
  section.append(heading,schedule);
  const message=node('p',t('loading'),'subtle'),output=node('div',undefined,'review-result');
  message.setAttribute('role','status');section.append(message,output,manual);
  const options=report?reports.filter(r=>r.id!==report.id):[];
  const snapshotLabel=r=>[t(r.mode==='live'?'liveTrading':'paperTrading'),r.strategyId,r.accountId,utc(r.asOf)+' UTC'].join(' · ');
  const inputs=[];
  const scopeList=node('div',undefined,'review-options');
  for(const r of options){
    const label=node('label'),box=node('input');box.type='checkbox';box.value=r.id;
    label.append(box,node('span',snapshotLabel(r)));scopeList.append(label);
    inputs.push(box);
  }
  scopeList.onchange=()=>{
    const full=inputs.filter(box=>box.checked).length>=7;
    for(const box of inputs)box.disabled=!box.checked&&full;
  };
  if(options.length)form.append(detailPanel(t('comparisonSnapshots'),scopeList));
  const label=node('label',undefined,'review-question'),question=node('textarea');
  question.rows=2;question.maxLength=2000;question.placeholder=t('reviewPromptHint');label.append(node('span',t('reviewObjective')),question);
  const start=node('button',t('startReview'),'primary');start.type='submit';
  form.append(label,start);
  const historyKey=report?.id??mode;
  let jobs=[],daily,selected,readVersion=0,listVersion=0,timer,scheduleTimer,lastRequest,lastDrawn;
  signal.addEventListener('abort',()=>{clearTimeout(timer);clearTimeout(scheduleTimer);},{once:true});

  function notice(text,isError=false){
    message.hidden=!text;message.className=isError?'problem':'subtle';message.replaceChildren();
    if(text)message.append(node('span',t(text)));
    if(text==='MODEL_REQUIRED'||text==='MODEL_CREDENTIAL')message.append(' ',link(t('modelSettings'),'#settings'));
  }
  function populate(){
    history.hidden=!jobs.length;
    history.replaceChildren(...jobs.map(j=>makeOption(j.id,reviewLabel(j,t,utc))));
    history.value=selected||'';
  }
  function drawSchedule(){
    schedule.replaceChildren(node('strong',t('dailyReview')));
    if(!daily)return;
    schedule.append(node('p',daily.enabled?t('dailySchedule').replace('{time}',daily.time):t('dailyDisabled'),'subtle'));
    const rows=[];
    const local=new Intl.DateTimeFormat(lang,{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Shanghai',hourCycle:'h23'});
    if(daily.nextAt)rows.push([t('nextDaily'),local.format(new Date(daily.nextAt))]);
    if(daily.nextCheckAt&&daily.nextCheckAt!==daily.nextAt)rows.push([t('nextCheck'),local.format(new Date(daily.nextCheckAt))]);
    const last=daily.modes?.[mode];
    if(daily.lastDate&&last){
      const job=jobs.find(j=>j.id===last.reviewId);
      rows.push([t('lastDaily'),daily.lastDate+' · '+t(job?'review_'+job.status:'daily_'+last.status)]);
    }
    if(rows.length)schedule.append(properties(rows));
    if(daily.enabled&&last?.status==='model_unavailable')schedule.append(link(t('modelSettings'),'#settings'));
  }
  function timeWindow(context){
    const p=context.commonWindow;
    return context.period?[[t('dailyStart'),utc(p.start)],[t('dailyEnd'),utc(p.end)]]:
      [[t('windowStart'),utc(p.start)],[t('windowEnd'),utc(p.end)]];
  }
  function sources(refs,context){
    const group=node('div',undefined,'review-sources');
    if(!refs?.length)return group;
    group.append(node('span',t('sourceRecords')));
    for(const ref of refs){
      const [id,...parts]=ref.split('/');
      const source=context?.reports.find(r=>r.ref===id||r.sourceReportIds?.includes(id));
      const meta=reports.find(r=>r.id===id)||source;
      if(!meta)continue;
      const kind=parts.shift(),decoded=parts.map(s=>{try{return decodeURIComponent(s);}catch{return s;}});
      const short=[t(meta.mode==='live'?'liveTrading':'paperTrading'),meta.strategyId,t('ref_'+(kind||'snapshot')),...decoded].join(' · ');
      const tail=ref.slice(id.length+1);
      const href=reviewPath(meta.mode,id,tail);
      const collection=kind==='window'||kind==='fees'?kind:context?.period&&({currency:'currencies',instrument:'instruments'})[kind];
      const sample=collection&&source?.[collection]?.find(row=>row.ref===ref);
      if(!sample){group.append(link(short,href,'record'));continue;}
      const details=node('div',undefined,'review-source-data');
      let data;
      if(kind==='instrument')data=[['instrument',sample.instrument],['fillCount',sample.fillCount],['makerFills',sample.makerFills],['takerFills',sample.takerFills],['closedCount',sample.closedCount],
        ['dailyOpenLong',sample.openLong],['dailyOpenShort',sample.openShort]];
      else if(kind==='currency')data=[['currency',sample.currency],['realizedNetPnl',sample.realizedPnl],['realizedDrawdown',sample.maxDrawdown],['closedCount',sample.closedCount],
        ['winRate',sample.winRate==null?null:new Intl.NumberFormat(lang,{style:'percent',maximumFractionDigits:2}).format(sample.winRate)],['profitFactor',sample.profitFactor],['fillFees',sample.fees]];
      else if(kind==='window')data=[['currency',sample.currency],['closedCount',sample.closedCount],['winCount',sample.wins],['worstClose',sample.worstPnl],['medianClose',sample.medianPnl],['bestClose',sample.bestPnl],
        ['beforeWindow',sample.beforeWindowPnl],['atWindowEnd',sample.throughWindowPnl]];
      else data=[['currency',sample.currency],[context.period?'windowFeeCount':'feeCount',sample.count],['minFee',sample.minimum],['medianFee',sample.median],['maxFee',sample.maximum]];
      details.append(properties(data.map(([key,value])=>[t(key),value])));
      if(context.commonWindow){
        const rows=timeWindow(context);
        if(!context.period&&kind==='fees'&&sample.window)rows.push([t('windowFeeCount'),sample.window.count],[t('windowMedianFee'),sample.window.median],[t('windowMaxFee'),sample.window.maximum]);
        details.append(properties(rows));
      }
      details.append(link(t('openSnapshot'),href,'record'));group.append(detailPanel(short,details));
    }
    return group;
  }
  function show(job){
    output.replaceChildren();
    const line=node('div',undefined,'review-progress');
    line.append(node('strong',t('review_'+job.status)),node('span',t(job.trigger==='daily'?'dailyReview':'manualReview')),node('span',utc(job.created)+' UTC'));
    if(job.modelSettings?.model)line.append(node('span',job.modelSettings.model));
    output.append(line);
    if(job.period)output.append(properties([[t('reviewDay'),job.period.date]]));
    const steps=node('ol',undefined,'review-steps');
    const current=job.decisions?3:job.diagnosis?2:job.context?1:0;
    for(const [i,key] of ['reviewInputs','reviewDiagnosis','reviewDecisions'].entries()){
      const step=node('li',t(key));
      if(i<current)step.className='done';
      else if(i===current)step.setAttribute('aria-current','step');
      steps.append(step);
    }
    output.append(steps);
    if(job.objective)output.append(properties([[t('reviewObjective'),job.objective]]));
    if(job.reportIds?.length){
      const refs=node('div',undefined,'review-source-data');
      const period=job.context?.commonWindow;
      if(period)refs.append(properties(timeWindow(job.context)));
      else if(job.context&&job.reportIds.length>1)refs.append(node('p',t('noCommonWindow'),'subtle'));
      for(const id of job.reportIds){
        const r=reports.find(r=>r.id===id),source=job.context?.reports.find(r=>r.ref===id);
        refs.append(link(r?snapshotLabel(r):id,reviewPath(r?.mode||job.mode,id),'record'));
        if(source){
          const rows=[[t('fillCount'),source.fillCount],[t('closedCount'),source.closedPositionCount],[t(job.period?'dailyOpenCount':'openCount'),source.openPositionCount]];
          if(job.period)rows.push([t('dayCoverage'),t(source.hasDayCapture?'dayCaptured':'dayPartial')]);
          refs.append(properties(rows));
        }
      }
      output.append(detailPanel(t('reviewInputs')+' · '+job.reportIds.length,refs));
    }
    if(job.diagnosis?.findings?.length){
      const findings=node('div',undefined,'review-findings');findings.append(node('h3',t('reviewDiagnosis')));
      for(const f of job.diagnosis.findings){
        const block=node('div');block.append(node('p',f.observation),sources(f.refs,job.context));
        if(f.uncertainty)block.append(node('p',t('reviewUncertainty')+' · '+f.uncertainty,'subtle'));
        findings.append(block);
      }
      output.append(findings);
    }
    if(job.decisions){
      const cards=node('div',undefined,'review-decisions');
      for(const key of ['strategy','portfolio','parameters']){
        const d=job.decisions[key];if(!d)continue;
        const article=node('article'),header=node('div',undefined,'section-heading');
        header.append(node('h4',t('decision_'+key)),node('span',t('decision_'+d.action),'state'));
        article.append(header,node('p',d.reason),sources(d.refs,job.context),properties([[t('reviewUncertainty'),d.uncertainty],[t('reviewNextStep'),d.nextStep]]));
        cards.append(article);
      }
      output.append(node('h3',t('reviewDecisions')),cards);
    }
    if(job.error)notice(job.error,true);
  }
  async function read(id){
    clearTimeout(timer);selected=id;history.value=id;
    const version=++readVersion;
    try{
      const job=await api(base+'/'+encodeURIComponent(id),undefined,signal);
      if(signal.aborted||version!==readVersion)return;
      const item=jobs.find(j=>j.id===id);if(item)item.status=job.status;
      const changed=!lastDrawn||lastDrawn.id!==job.id||lastDrawn.status!==job.status||!!lastDrawn.context!==!!job.context;
      if(changed){
        const expanded=new Set([...output.querySelectorAll('details[open] > summary')].map(s=>s.textContent));
        populate();drawSchedule();notice();show(job);lastDrawn=job;
        for(const detail of output.querySelectorAll('details'))if(expanded.has(detail.firstChild.textContent))detail.open=true;
      }else if(!job.error)notice();
      if(job.status==='diagnosing'||job.status==='deciding')timer=setTimeout(()=>read(id),2500);
    }catch(e){
      if(signal.aborted||version!==readVersion)return;
      notice(e.message,true);
      if(e.message!=='NOT_FOUND')timer=setTimeout(()=>read(id),5000);
    }
  }
  async function list(preferred){
    const version=++listVersion;
    const query=new URLSearchParams({mode});if(report)query.set('reportId',report.id);
    const result=await api(base+'?'+query,undefined,signal);
    if(signal.aborted||version!==listVersion)return;
    jobs=result.reviews;manual.hidden=!report||!result.writable;
    daily=result.daily;drawSchedule();
    const previous=lastReview.get(historyKey);
    selected=preferred||(jobs.some(job=>job.id===previous)?previous:jobs[0]?.id);populate();
    clearTimeout(scheduleTimer);
    const next=daily?.nextCheckAt||daily?.nextAt;
    if(next){
      const dailyJob=jobs.find(job=>job.id===daily.modes?.[mode]?.reviewId);
      const watchOther=dailyJob&&dailyJob.id!==selected&&['diagnosing','deciding'].includes(dailyJob.status);
      const delay=watchOther?5000:Math.max(15000,Date.parse(next)-Date.now()+1000);
      scheduleTimer=setTimeout(refresh,delay);
    }
    if(selected)await read(selected);
    else notice();
  }
  function refresh(){void list().catch(e=>{if(!signal.aborted){notice(e.message,true);scheduleTimer=setTimeout(refresh,15000);}});}
  history.onchange=()=>{lastReview.set(historyKey,history.value);lastDrawn=undefined;output.replaceChildren();notice('loading');refresh();};
  form.onsubmit=async event=>{
    event.preventDefault();if(start.disabled)return;start.disabled=true;notice('loading');
    const reportIds=[report.id,...inputs.filter(box=>box.checked).map(box=>box.value)],objective=question.value.trim();
    const key=JSON.stringify([reportIds,objective]);
    if(lastRequest?.key!==key)lastRequest={key,id:crypto.randomUUID()};
    try{
      const {id}=await api(base,{id:lastRequest.id,reportIds,objective:objective||undefined},signal);
      lastReview.set(historyKey,id);await list(id);manual.open=false;lastRequest=undefined;
    }catch(e){if(!signal.aborted)notice(e.message,true);}
    finally{start.disabled=false;}
  };
  refresh();
  return section;
}
