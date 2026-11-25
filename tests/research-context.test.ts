import { test } from 'node:test';
import assert from 'node:assert/strict';
import {agentWriteError,researchDirection,researchPromptContext,runAdmission,sameRunAdmission} from '../src/research-context.ts';

test('research direction is optional, immutable for retries, and not a holding-period override',()=>{
  assert.equal(researchDirection(undefined),'');
  assert.throws(()=>researchDirection('a'.repeat(4001)),/INVALID_RESEARCH_DIRECTION/);
  const direction='假设：成交量放大后的反转有预测价值';
  const a=runAdmission({direction:'  '+direction+' ',horizon:5,unrecognized:'not stored'});
  const b=runAdmission({horizon:5,direction});
  assert.deepEqual(a,b);
  assert.equal(sameRunAdmission(a,b),true);
  assert.equal(sameRunAdmission(a,runAdmission({horizon:5,direction:'New goal'})),false);
  assert.equal(sameRunAdmission(undefined,b),true);
  assert.match(researchPromptContext({direction,horizon:5,barSpec:'1-MINUTE-LAST'}),/not a holding period/);
  assert.match(researchPromptContext({}),/"researchDirection":null/);
});

test('agent write paths separate browser use, local CLI and configured bearer auth',()=>{
  const localHost=true;
  assert.equal(agentWriteError({localHost,origin:'http://localhost:25447'}),'WEB_READ_ONLY');
  assert.equal(agentWriteError({localHost,browser:'cors',authorization:'Bearer one'},'one'),'WEB_READ_ONLY');
  assert.equal(agentWriteError({localHost}),null);
  assert.equal(agentWriteError({localHost:false}),'AGENT_AUTH_REQUIRED');
  assert.equal(agentWriteError({localHost,authorization:'Bearer two'},'one'),'AGENT_AUTH_REQUIRED');
  assert.equal(agentWriteError({localHost:false,authorization:'Bearer one'},'one'),null);
});
