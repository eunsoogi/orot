import { renderHook } from '@testing-library/react-native';
import { runMigrations, type SqlDatabase } from '@orot/storage';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createLocalEvidenceData } from '../../healthEvidence/localEvidenceData';
import { ensureHealthContextGeneration } from '../../healthEvidence/healthContext/generation';
import { createHealthContextTool } from '../../aiFeatures/integration/healthContextTool';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { openOpSqliteWorker } from '../../../test-support/opSqliteWorkerFixture';
import { useOverviewMetrics } from './useOverviewMetrics';
const fs = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
let mockDatabase: SqlDatabase;
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalStorage: async () =>
    jest.requireActual('@orot/storage').createRecordRepository(mockDatabase),
  openLocalAgentMemoryDatabase: async () => mockDatabase,
}));

/** Real hook disposal queues behind a real aggregate on the installed JS
 * transaction scheduler. There is no artificial lock, sleep or provider call. */
test('discarded overview scenes do not run queued aggregate snapshots after a tool', async () => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'abandoned-overview-'));
  const f = openOpSqliteWorker(path.join(directory, 'synthetic.sqlite'), false);
  const completed: Promise<void>[] = [];
  const mounted = new Set<() => Promise<void>>();
  const queued: (() => void)[] = [];
  const queuedSignals = [0, 1].map(
    () => new Promise<void>(resolve => queued.push(resolve)),
  );
  let aggregateQueries = 0;
  let callbackQueries = 0;
  let toolCompleted = false;
  let lifecycle: Promise<void> | undefined;
  mockDatabase = {
    execute: (query, bindings) => f.database.execute(query, bindings),
    transaction(work) {
      const index = completed.length;
      const promise = f.database.transaction(tx =>
        work({
          ...tx,
          execute: (query, bindings) => {
            callbackQueries++;
            if (/\bWITH\s+(?:RECURSIVE\s+)?(?:days|calendar)\s*\(/i.test(query))
              aggregateQueries++;
            return tx.execute(query, bindings);
          },
        }),
      );
      completed.push(promise);
      queued[index]?.();
      return promise;
    },
  };
  try {
    await runMigrations(f.database);
    await ensureHealthContextGeneration(f.database);
    for (let batch = 0; batch < 30; batch++) {
      const rows = Array.from({ length: 1000 }, (_, offset) => {
        const i = batch * 1000 + offset;
        return healthObservation(
          `abandoned-${i}`,
          'heart_rate',
          new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
        );
      });
      await f.database.execute(
        `INSERT INTO health_observations (id,effective_at,recorded_at,ingested_at,payload_json)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.effectiveAt'),json_extract(value,'$.recordedAt'),json_extract(value,'$.ingestedAt'),value FROM json_each(?)`,
        [JSON.stringify(rows)],
      );
    }
    const data = createLocalEvidenceData(f.database);
    const tool = createHealthContextTool(
      data.readHealthContext!,
      new LocalEvidenceReferenceRegistry(),
      'rag',
    );
    f.observe(event => {
      if (event.kind !== 'aggregate' || event.phase !== 'start') return;
      f.observe();
      lifecycle = (async () => {
        for (let index = 0; index < 2; index++) {
          const hook = await renderHook(() => useOverviewMetrics());
          const unmount = () => hook.unmount();
          mounted.add(unmount);
          await queuedSignals[index];
          expect(toolCompleted).toBe(false);
          await unmount();
          mounted.delete(unmount);
        }
      })();
    });
    await tool.search({
      input: {
        topics: ['measurements'],
        window: {
          fromInclusive: '2026-01-01T00:00:00Z',
          toExclusive: '2026-02-01T00:00:00Z',
          timeZone: 'UTC',
        },
      },
      operationRunId: 'synthetic',
      operationKey: 'tool',
      allowedScope: { sourceKinds: ['personal_record'] },
      resultLimit: 8,
      maxPayloadBytes: 1000000,
      executionLimits: 'unbounded',
      signal: new AbortController().signal,
    });
    toolCompleted = true;
    expect(lifecycle).toBeDefined();
    await lifecycle;
    await Promise.allSettled(completed);
    console.info(
      'SYNTHETIC_ABANDONED_OVERVIEW',
      JSON.stringify({
        queued: completed.length,
        aggregateQueries,
        callbackQueries,
      }),
    );
    expect(completed).toHaveLength(2);
    expect(aggregateQueries).toBe(0);
    expect(callbackQueries).toBe(0);
  } finally {
    for (const unmount of mounted) await unmount();
    await Promise.allSettled(completed);
    expect(await f.close()).toBe(0);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}, 30000);
