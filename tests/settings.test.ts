import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {exportJWK,generateKeyPair,SignJWT} from 'jose';
import {applySettings,cloudflareSettingsAccess,localSettingsRequest,settingsStore} from '../src/settings.ts';

test('section edits persist together and a rejected edit leaves the saved values intact',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'az-settings-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=settingsStore(dir);
  const save=(section:string,patch:unknown)=>store.edit(s=>applySettings(s,section,patch));
  const dataDir=join(dir,'research');
  await Promise.all([
    save('data',{stateDir:dataDir,agentToken:'research-token'}),
    save('review',{time:'23:30',enabled:false}),
    save('nautilus',{python:'/usr/bin/python3',strategyToken:'delivery-token'}),
  ]);
  await assert.rejects(save('review',{time:'24:00',enabled:true}),/BAD_REQUEST/);
  await assert.rejects(save('data',{port:0}),/BAD_REQUEST/);
  await assert.rejects(save('data',{accessTeam:'outside.example/path'}),/BAD_REQUEST/);
  await assert.rejects(save('data',{accessAud:'wrong application tag'}),/BAD_REQUEST/);
  await assert.rejects(save('nautilus',{strategyToken:'',targets:[{}]}),/STRATEGY_TARGET_CONFIG/);
  await save('data',{catalog:join(dir,'catalog')});
  const saved=await settingsStore(dir).read();
  assert.equal(saved.data.stateDir,dataDir);
  assert.equal(saved.data.agentToken,'research-token');
  assert.deepEqual(saved.review,{enabled:false,time:'23:30',language:'zh-CN',objective:''});
  assert.deepEqual(saved.nautilus,{python:'/usr/bin/python3',targets:[],strategyToken:'delivery-token'});
  await save('data',{agentToken:''});
  assert.equal((await store.read()).data.agentToken,'');
});

test('settings require a local host name and a connection from the host',()=>{
  const socket={localAddress:'172.17.0.2',remoteAddress:'172.17.0.1'};
  assert.equal(localSettingsRequest('localhost:8787',socket,'172.17.0.1'),true);
  assert.equal(localSettingsRequest('outside.example',socket,'172.17.0.1'),false);
  assert.equal(localSettingsRequest('127.0.0.1:8787',socket),false);
  assert.equal(localSettingsRequest('[::1]:8787',{localAddress:'::1',remoteAddress:'::1'}),true);
});

test('remote settings accept only a signed, unexpired token for the configured Access app',async t=>{
  const config={accessTeam:'test-team',accessAud:'a'.repeat(64)};
  const issuer='https://test-team.cloudflareaccess.com';
  const {privateKey,publicKey}=await generateKeyPair('RS256');
  const jwk=await exportJWK(publicKey);
  const fetchKeys=t.mock.method(globalThis,'fetch',async(url:string)=>{
    assert.equal(url,issuer+'/cdn-cgi/access/certs');
    return Response.json({keys:[{...jwk,kid:'test-key'}]});
  });
  const claims={iss:issuer,aud:[config.accessAud],exp:Math.floor(Date.now()/1000)+60,type:'app'};
  const sign=(changes:Record<string,unknown>={})=>new SignJWT({...claims,...changes})
    .setProtectedHeader({alg:'RS256',kid:'test-key'}).sign(privateKey);
  const valid=await sign();
  assert.equal(await cloudflareSettingsAccess(valid,config),true);
  for(const change of [{aud:['another-app']},{iss:'https://other.cloudflareaccess.com'},{exp:0},{exp:undefined},{type:'org'}]){
    assert.equal(await cloudflareSettingsAccess(await sign(change),config),false);
  }
  const [header,payload]=valid.split('.');
  assert.equal(await cloudflareSettingsAccess(header+'.'+payload+'.AAAA',config),false);
  assert.equal(await cloudflareSettingsAccess(undefined,config),false);
  assert.equal(await cloudflareSettingsAccess(valid,{}),false);
  assert.equal(fetchKeys.mock.callCount(),1);
});
