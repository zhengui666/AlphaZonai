import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {createSession,MemoryStorage} from '@earendil-works/pi-durable';
import {importPerformance,performanceReport,PerformanceIndex,PerformanceReport} from '../src/performance.ts';

test('performance imports keep distinct paper and live snapshots and reconcile concurrent retries',async()=>{
  const session=createSession(new MemoryStorage());
  const paper=performanceReport({
    id:randomUUID(),sessionId:randomUUID(),mode:'paper',accountId:'ACCOUNT-1',strategyId:'TREND-01',
    asOf:'2026-11-27T00:30:00.000123Z',currencies:[],balances:[],fills:[],positions:[],
  });
  const live={...paper,id:randomUUID(),sessionId:randomUUID(),mode:'live' as const,coverageStart:'2026-11-25T16:00:00Z'};
  const save=(report:typeof paper)=>session.commit(tx=>importPerformance(tx,report),ctx);
  try{
    assert.deepEqual(await Promise.all([save(paper),save(paper)]),[201,200]);
    assert.equal(await save({...paper,mode:'live'}),409);
    assert.equal(await save(live),201);
    assert.deepEqual(await session.snapshot(PerformanceReport,paper.id,ctx),paper);
    assert.deepEqual(await session.snapshot(PerformanceReport,live.id,ctx),live);
    const reports=(await session.snapshot(PerformanceIndex,ctx))!.reports;
    assert.deepEqual(Object.keys(reports).sort(),[paper.id,live.id].sort());
    assert.equal('fills' in reports[paper.id],false);
    assert.equal(reports[live.id].coverageStart,live.coverageStart);
    assert.throws(()=>performanceReport({...live,coverageStart:'2026-11-28T00:00:00Z'}),/INVALID_PERFORMANCE_REPORT/);
    assert.throws(()=>performanceReport({...paper,mode:'backtest'}),/INVALID_PERFORMANCE_REPORT/);
    assert.throws(()=>performanceReport({...paper,balances:[{currency:'USD',total:12,free:'12',locked:'0'}]}),/INVALID_PERFORMANCE_REPORT/);
  }finally{await session.close(ctx);}
});
