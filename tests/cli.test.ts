import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const cli=fileURLToPath(new URL('../cli/alphazonai.mjs',import.meta.url));
const run='10000000-0000-4000-8000-000000000001';
const strategy='20000000-0000-4000-8000-000000000002';
const dates=['--start','2026-10-01','--end','2026-10-08'];
function invoke(args:string[],stdin='',env?:Record<string,string>){
  return new Promise<{code:number;out:string;err:string}>((resolve,reject)=>{
    const child=spawn(process.execPath,[cli,...args],{env:env&&{...process.env,...env}});
    let out='',err='';
    child.stdout.setEncoding('utf8').on('data',s=>out+=s);
    child.stderr.setEncoding('utf8').on('data',s=>err+=s);
    child.stdin.on('error',()=>{});
    child.on('error',reject);
    child.on('close',code=>resolve({code:code??1,out,err}));
    child.stdin.end(stdin);
  });
}
const json=(res:ServerResponse,status:number,v:unknown)=>{
  res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(v));
};
async function fixture(handler:(req:IncomingMessage,res:ServerResponse)=>void|Promise<void>, use:(origin:string)=>Promise<void>){
  const server=createServer((req,res)=>void Promise.resolve(handler(req,res)).catch(()=>json(res,500,{error:'FIXTURE_ERROR'})));
  await new Promise<void>((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  try{
    const address=server.address();
    if(!address||typeof address==='string')throw Error('Invalid address');
    await use('http://127.0.0.1:'+address.port);
  }finally{await new Promise<void>(done=>server.close(()=>done()));}
}

test('CLI discovers commands and previews exact payload without credentials or network',async()=>{
  const s=await invoke(['schema','runs','start']);
  assert.equal(s.code,0);assert.equal(s.err,'');
  assert.equal(JSON.parse(s.out).data.options['direction-file'].type,'file');
  const p=await invoke(['runs','start','--id',run,...dates,'--horizon','7','--direction-file','-','--dry-run'],
    '动量与反转\n',{ALPHAZONAI_URL:'https://unused.invalid',ALPHA_AGENT_TOKEN:'never-print-this'});
  assert.equal(p.code,0);assert.equal(p.err,'');
  assert.ok(!p.out.includes('never-print-this'));
  assert.deepEqual(JSON.parse(p.out).data,{method:'POST',url:'http://127.0.0.1:8787/api/runs',
    body:{id:run,preset:'minute',start:'2026-10-01',end:'2026-10-08',horizon:7,seed:42,direction:'动量与反转\n'},auth:'agent'});
  const bad=await invoke(['runs','start','--id',run,...dates,'--unexpected','x','--dry-run']);
  assert.equal(bad.code,2);assert.equal(bad.out,'');assert.equal(JSON.parse(bad.err).error.code,'USAGE');
});

test('CLI reads settings and submits each section without printing secret input values',async()=>{
  const secret='test-credential-value';
  const updates={
    model:{action:'connect',key:secret},nautilus:{targets:[],strategyToken:secret},
    review:{enabled:false,time:'09:30',language:'en',objective:'Review fees'},
    data:{catalog:'/data/bars',agentToken:secret,accessTeam:'my-team',accessAud:'a'.repeat(64)},
  };
  const schema=await invoke(['schema','settings','set']);
  assert.deepEqual(Object.keys(JSON.parse(schema.out).data.fields),Object.keys(updates));
  const view={writable:true,model:{stored:true},nautilus:{strategyTokenConfigured:true},review:updates.review,data:{agentTokenConfigured:true}};
  const received:unknown[]=[];
  await fixture(async(req,res)=>{
    if(req.method==='POST'){
      let body='';for await(const chunk of req)body+=chunk;
      received.push([req.url,JSON.parse(body)]);
    }else assert.equal(req.url,'/api/settings');
    json(res,200,view);
  },async origin=>{
    const read=await invoke(['settings','get','--url',origin]);
    assert.deepEqual(JSON.parse(read.out).data,view);
    for(const [section,patch] of Object.entries(updates)){
      const args=['settings','set','--url',origin,'--section',section,'--file','-'];
      const preview=await invoke([...args,'--dry-run'],JSON.stringify(patch));
      assert.deepEqual(JSON.parse(preview.out).data.fields,Object.keys(patch));
      assert.ok(!(preview.out+preview.err).includes(secret));
      const saved=await invoke(args,JSON.stringify(patch));
      assert.deepEqual(JSON.parse(saved.out).data,view);
    }
    assert.deepEqual(received,Object.entries(updates).map(([key,value])=>['/api/settings/'+key,value]));
    const invalid=await invoke(['settings','set','--section','model','--file','-'],'{"key":"'+secret+'"');
    assert.equal(invalid.code,2);
    assert.ok(!(invalid.out+invalid.err).includes(secret));
  });
});

test('settings commands use an Access cookie and require an application token for remote updates',async t=>{
  const token='sample.header.signature',dir=await mkdtemp(join(tmpdir(),'alpha-cli-access-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const patch=join(dir,'settings.json');
  await writeFile(patch,'{"language":"en"}');
  const update=['settings','set','--section','review','--file',patch];
  const blocked=await invoke([...update,'--url','https://example.invalid']);
  assert.equal(blocked.code,2);assert.match(JSON.parse(blocked.err).error.message,/--token-file/);
  const invalid=await invoke([...update,'--url','https://example.invalid','--token-file','-'],'research-token');
  assert.equal(invalid.code,2);assert.ok(!invalid.err.includes('research-token'));
  await fixture((req,res)=>{
    assert.equal(req.headers.cookie,'CF_Authorization='+token);
    assert.equal(req.headers.authorization,undefined);
    json(res,200,{writable:true});
  },async origin=>{
    for(const cmd of [['settings','get'],update]){
      const result=await invoke([...cmd,'--url',origin,'--token-file','-'],token);
      assert.equal(result.code,0);assert.ok(!result.out.includes(token));
    }
  });
});

test('CLI preserves the write ID and distinguishes acceptance from a finished run',async()=>{
  const seen:any[]=[];
  await fixture(async(req,res)=>{
    if(req.method==='POST'){
      let body='';for await(const s of req)body+=s;
      seen.push({body:JSON.parse(body),auth:req.headers.authorization,origin:req.headers.origin});
      json(res,202,{id:run});
    }else json(res,200,{id:run,status:'completed'});
  },async origin=>{
    const args=['runs','start','--url',origin,'--id',run,...dates,'--direction','Compare rank signals','--token-file','-'];
    const a=await invoke(args,'agent-fixture\n');
    const b=await invoke(args,'agent-fixture\n');
    assert.equal(a.code,0);assert.equal(b.code,0);
    assert.deepEqual(seen[0],seen[1]);assert.equal(seen[0].auth,'Bearer agent-fixture');
    assert.equal(seen[0].origin,undefined);
    assert.equal(JSON.parse(a.out).meta.accepted,true);
    assert.equal(JSON.parse(a.out).meta.reconcile.id,run);
    const w=await invoke(['runs','wait','--url',origin,'--id',run,'--wait-ms','30000']);
    assert.equal(JSON.parse(w.out).data.status,'completed');
  });
});

test('CLI uses the independent strategy token and exposes delivery receipt',async()=>{
  await fixture(async(req,res)=>{
    if(req.method==='POST'){
      let s='';for await(const chunk of req)s+=chunk;
      assert.equal(req.headers.authorization,'Bearer strategy-fixture');
      assert.deepEqual(JSON.parse(s),{action:'push',id:strategy,target:'receiver'});
      json(res,202,{id:strategy});
    }else json(res,200,{strategies:{[strategy]:{status:'validated',
      deployments:{receiver:{status:'staged',receipt:{status:'staged',activated:false,instance:'receiver'}}}}}});
  },async origin=>{
    const args=['--url',origin,'--id',run,'--strategy',strategy,'--target','receiver'];
    const accepted=await invoke(['strategies','push',...args,'--token-file','-'],'strategy-fixture');
    assert.equal(accepted.code,0);assert.equal(JSON.parse(accepted.out).meta.accepted,true);
    const staged=await invoke(['strategies','wait',...args]);
    assert.equal(staged.code,0);assert.equal(JSON.parse(staged.out).data.receipt.activated,false);
  });
});

test('CLI reports uncertain writes without automatically resending',async()=>{
  let count=0;
  await fixture((req,res)=>{count++;res.destroy();},async origin=>{
    const v=await invoke(['runs','start','--url',origin,'--id',run,...dates]);
    assert.equal(v.code,4);assert.equal(v.out,'');assert.equal(count,1);
    const error=JSON.parse(v.err).error;
    assert.equal(error.outcome,'unknown');
    assert.deepEqual(error.reconcile,{command:'runs get',id:run});
  });
});

test('CLI imports the original performance report and reads its list and detail',async t=>{
  const report={id:run,mode:'paper',fills:[]};
  const directory=await mkdtemp(join(tmpdir(),'alpha-cli-token-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const tokenFile=join(directory,'token');
  await writeFile(tokenFile,'report-token\n',{mode:0o600});
  await fixture(async(req,res)=>{
    if(req.method==='POST'){
      assert.equal(req.url,'/api/performance');
      assert.equal(req.headers.authorization,'Bearer report-token');
      let body='';for await(const chunk of req)body+=chunk;
      assert.deepEqual(JSON.parse(body),report);
      return json(res,201,{id:run});
    }
    assert.equal(req.headers.authorization,undefined);
    if(req.url==='/api/performance')return json(res,200,{reports:[{id:run}]});
    assert.equal(req.url,'/api/performance/'+run);
    json(res,200,report);
  },async origin=>{
    const imported=await invoke(['performance','import','--url',origin,'--report-file','-','--token-file',tokenFile],JSON.stringify(report));
    assert.equal(imported.code,0);assert.deepEqual(JSON.parse(imported.out).data,{id:run});
    const list=await invoke(['performance','list','--url',origin]);
    assert.deepEqual(JSON.parse(list.out).data.reports,[{id:run}]);
    const detail=await invoke(['performance','show','--url',origin,'--id',run]);
    assert.deepEqual(JSON.parse(detail.out).data,report);
    const invalid=await invoke(['performance','import','--url',origin,'--report-file','-'],'{broken');
    assert.equal(invalid.code,2);assert.equal(JSON.parse(invalid.err).error.code,'USAGE');
  });
});

test('CLI requests an AI review and shows its persisted result',async()=>{
  const review='30000000-0000-4000-8000-000000000003';
  const history={reviews:[{id:review,trigger:'daily'}],daily:{lastDate:'2026-11-26'}};
  const objective='Compare trading costs at portfolio weights of 40% and 60%.';
  const selection=['performance','review','--id',run,'--review',review];
  const preview=await invoke([...selection,'--dry-run']);
  assert.deepEqual(JSON.parse(preview.out).data.body,{id:review,reportIds:[run]});
  const invalid=await invoke([...selection,'--with','invalid','--dry-run']);
  assert.equal(invalid.code,2);
  await fixture(async(req,res)=>{
    if(req.method==='POST'){
      assert.equal(req.url,'/api/performance/reviews');
      assert.equal(req.headers.authorization,'Bearer review-token');
      let body='';for await(const chunk of req)body+=chunk;
      assert.deepEqual(JSON.parse(body),{id:review,reportIds:[run,strategy],objective,language:'en'});
      return json(res,202,{id:review});
    }
    assert.equal(req.headers.authorization,undefined);
    if(req.url==='/api/performance/reviews')return json(res,200,history);
    assert.equal(req.url,'/api/performance/reviews/'+review);
    json(res,200,{id:review,status:'completed'});
  },async origin=>{
    const requested=await invoke([...selection,'--url',origin,'--with',strategy,'--objective',objective,'--language','en','--token-file','-'],'review-token');
    assert.equal(requested.code,0);
    assert.deepEqual(JSON.parse(requested.out).meta.reconcile,{command:'performance review-show',review});
    const listed=await invoke(['performance','review-list','--url',origin]);
    assert.deepEqual(JSON.parse(listed.out).data,history);
    const result=await invoke(['performance','review-show','--url',origin,'--review',review]);
    assert.deepEqual(JSON.parse(result.out).data,{id:review,status:'completed'});
  });
});

test('CLI export creates a raw artifact and never overwrites an existing file',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'alpha-cli-test-'));
  try{
    const path=join(directory,'factors.json');
    await fixture((req,res)=>json(res,200,{factors:[]}),async origin=>{
      const args=['runs','export','--url',origin,'--id',run,'--output',path];
      const out=await invoke(args);
      assert.equal(out.code,0);
      assert.deepEqual(JSON.parse(await readFile(path,'utf8')),{factors:[]});
      const second=await invoke(args);
      assert.equal(second.code,2);assert.equal(JSON.parse(second.err).error.code,'OUTPUT_EXISTS');
    });
  }finally{await rm(directory,{recursive:true,force:true});}
});
