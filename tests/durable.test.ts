import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {join} from 'node:path';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {Harness,createRegistry} from '@earendil-works/pi-durable';
import {openNodeSqliteStorage} from '@earendil-works/pi-durable/storage/sqlite/node';
import {createModels} from '@earendil-works/pi-ai/models';
import {createCogAlpha,Runs,Resume,setModelSpeed} from '../src/extension.ts';
import {paper} from '../src/method.ts';

test('native Pi tasks keep candidate failures and recover the same generation',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'az-pi-'));
  const counts=new Map<string,number>();
  const {extension,Run}=createCogAlpha({
    keys:['quality'],contract:'Text quality',
    prepare:async()=>({rows:3}),
    score:async (code,c,signal)=>{
      counts.set(code,(counts.get(code)||0)+1);
      await delay(code==='0.0'?5:code==='0.1'?70:20,undefined,{signal});
      return code==='0.1'?{failure:'TEST_REJECTION'}:{scores:{quality:code==='0.0'?0.1:0.9}};
    }
  },async (_r,_c,id,text)=>{
    if(id.includes('feedback:'))return '{"summary":"Recorded outcomes"}';
    if(id.includes('guidance'))return '{"guidance":"Improve evidence selection."}';
    if(id.includes('code_quality:')||id.includes('judge:'))return '{"pass":true,"reason":"Valid text"}';
    return JSON.stringify({name:id,hypothesis:'Evidence ranking',formula:'example',code:id.split(':')[0]});
  });
  const open=async()=>{
    const registry=createRegistry();registry.install(extension);
    return Harness.open(await openNodeSqliteStorage(join(dir,'pi.db')),{models:createModels(),registry},ctx);
  };
  let h=await open();
  try {
    const root=await h.root(ctx);
    const id='run',rules={...paper,initial:3,children:3,generations:0,parallel:1,repairs:0};
    const task=await root.commit(async tx=>{
      const doc=await tx.doc(Runs,root.id);
      doc.runs[id]={id,status:'queued',generations:[],current:0,limit:0,pause:true};
      return tx.createTask(Run,{id,seed:1,rules},{ownership:{kind:'conversation'}});
    },ctx);
    const wait=async (p:(r:any)=>boolean)=>{
      for(let i=0;i<260;i++){
        const r=(await h.snapshot(Runs,root.id,ctx))!.runs[id];
        if(p(r))return r;
        await delay(10);
      }
      assert.fail(JSON.stringify({run:(await h.snapshot(Runs,root.id,ctx))?.runs[id],inspect:await h.inspect(ctx),tasks:await h.getTask(task,ctx)}));
    };
    h.resume();
    await wait(r=>r.status==='paused');
    await root.commit(async tx=>{
      (await tx.doc(Runs,root.id)).runs[id].pause=false;
      await tx.signal(task,Resume,'generation:0',{action:'resume'});
    },ctx);
    h.resume();
    await wait(r=>r.progress?.completed===1 && counts.has('0.1'));
    await h.close(ctx);
    h=await open();h.resume();
    const run=await wait(r=>r.status==='completed');
    assert.equal(run.generations.length,1);
    assert.equal(counts.get('0.0'),1);
    assert.equal(run.generations[0].rows[1].failure,'TEST_REJECTION');
    assert.deepEqual(run.generations[0].elites,['0.2']);
  } finally{
    await h.close(ctx);await rm(dir,{recursive:true,force:true});
  }
});

test('Pi native conversations return JSON to generation and review tasks',async()=>{
  const {openaiProvider}=await import('@earendil-works/pi-ai/providers/openai');
  const {createAssistantMessageEventStream}=await import('@earendil-works/pi-ai');
  const provider=openaiProvider();
  const model=provider.getModels().find(x=>x.id==='gpt-5.4')!;
  const seen:string[]=[], speed:unknown[]=[];
  const stream=(m:any,transcript:any,opts:any)=>{
    const last=transcript.messages.filter((x:any)=>x.role==='user').at(-1);
    const prompt=typeof last.content==='string'?last.content:last.content.map((x:any)=>x.text).join('');
    seen.push(prompt);
    const text=prompt.includes('Rewrite the role')?'{"guidance":"Independent signals."}':
      prompt.includes('Code Quality:')||prompt.includes('Judge:')?'{"pass":true,"reason":"Evidence reviewed"}':
      prompt.includes('Summarize evidenced')?'{"summary":"Validation complete"}':
      '{"name":"Candidate","hypothesis":"Effect","formula":"x","code":"actual-code"}';
    const r={role:'assistant',content:[{type:'text',text}],api:m.api,provider:m.provider,model:m.id,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()};
    const channel=createAssistantMessageEventStream();
    void (async()=>{
      try{
        const transformed=await opts?.onPayload?.({model:m.id},m);
        speed.push(transformed?.service_tier);
        channel.push({type:'done',reason:'stop',message:r});
      }catch(e){channel.push({type:'error',reason:'error',error:{...r,stopReason:'error',errorMessage:String(e)}});}
    })();
    return channel;
  };
  const models=createModels();
  models.setProvider({...provider,auth:{apiKey:{name:'Test transport',resolve:async()=>({auth:{apiKey:'test-transport'},source:'test'})}},stream,streamSimple:stream});
  const dir=await mkdtemp(join(tmpdir(),'az-role-'));
  const {extension,Run}=createCogAlpha({keys:['quality'],contract:'JSON-backed candidate',prepare:async()=>({}),score:async code=>({scores:{quality:code==='actual-code'?1:0}})});
  const registry=createRegistry();registry.install(extension);
  const h=await Harness.open(await openNodeSqliteStorage(join(dir,'pi.db')),{models,registry,onReport:r=>console.error(r)},ctx);
  try{
    const root=await h.root(ctx,{agent:{model:{provider:model.provider,modelId:model.id}}});
    const id='native';
    const task=await root.commit(async tx=>{
      (await tx.doc(Runs,root.id)).runs[id]={id,status:'queued',generations:[],current:0,limit:0};
      await setModelSpeed(tx,root.id,'priority');
      return tx.createTask(Run,{id,seed:1,rules:{...paper,initial:1,generations:0}},{ownership:{kind:'conversation'}});
    },ctx);
    h.resume();
    const settled=await h.waitForTask(task,ctx);
    assert.equal(settled.state.outcome.status,'completed');
    const run=(await h.snapshot(Runs,root.id,ctx))!.runs[id];
    assert.deepEqual(run.generations[0].rows[0].scores,{quality:1},JSON.stringify({row:run.generations[0].rows[0],seen}));
    assert.equal(seen.length,5);
    assert.deepEqual(speed,Array(5).fill('priority'));
  }finally{await h.close(ctx);await rm(dir,{recursive:true,force:true});}
});
