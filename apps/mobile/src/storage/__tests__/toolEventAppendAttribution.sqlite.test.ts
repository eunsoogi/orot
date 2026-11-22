import { NativeModules } from 'react-native';
import { runMigrations } from '@orot/storage';
import type { projectConversationToolEvent } from '@orot/agent-runtime';
import { openOpSqliteFileQueue } from '../../../test-support/opSqliteFileQueueFixture';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import {
  createToolAppendClock,
  heldAppendInterval,
  observeSyntheticAppend,
  startedToolEvent,
  syntheticTurn,
  toolAppendPhases,
} from '../testSupport/toolAppendAttributionFixture';

type Project = typeof projectConversationToolEvent;
let mockObserveProjection: ((actual: () => ReturnType<Project>) => ReturnType<Project>) | undefined;
jest.mock('@orot/agent-runtime', () => {
  const original = jest.requireActual<typeof import('@orot/agent-runtime')>('@orot/agent-runtime');
  return {
    ...original,
    projectConversationToolEvent: (...args: Parameters<Project>) =>
      mockObserveProjection
        ? mockObserveProjection(() => original.projectConversationToolEvent(...args))
        : original.projectConversationToolEvent(...args),
  };
});

test('attributes a terminal append to owned phases and separates awaited SQL from other transaction-body time', async () => {
  const f = openOpSqliteFileQueue();
  const clock = createToolAppendClock();
  const setup = heldAppendInterval();
  const admitted = heldAppendInterval();
  const query = heldAppendInterval();
  const afterSql = heldAppendInterval();
  const settlement = heldAppendInterval();
  const observer = observeSyntheticAppend(f.database, clock, setup, afterSql, settlement);
  const priorDiagnostics = NativeModules.OrotProviderDiagnostics;
  let blocker: Promise<void> | undefined;
  let append: Promise<void> | undefined;
  const report = jest.fn((feature: string, stage: string, outcome: string) => {
    if (clock.track(feature, stage, outcome) === 'admission' && outcome === 'started') {
      // Put a genuine queued writer ahead of this request.
      blocker = f.database.transaction(async () => admitted.wait());
    }
  });
  try {
    await runMigrations(f.database);
    const warm = createConversationArtifactStorage(f.database);
    await warm.createSession(syntheticTurn.sessionId, await warm.currentGeneration());
    await warm.appendToolEvent({ ...syntheticTurn, event: startedToolEvent });
    const record = healthObservation('synthetic-observation', 'heart_rate', '2026-10-01T00:00:00Z');
    await f.database.execute(
      'INSERT INTO health_observations (id,effective_at,recorded_at,ingested_at,payload_json) VALUES (?,?,?,?,?)',
      [
        record.id,
        record.effectiveAt,
        record.recordedAt!,
        record.ingestedAt,
        JSON.stringify(record),
      ],
    );
    const reference = {
      sourceKind: 'personal_record' as const,
      sourceId: 'synthetic-source',
      sourceRevision: '1',
      evidenceId: 'synthetic-evidence',
      evidenceRevision: '1',
      effectiveTime: null,
      reviewState: 'unknown' as const,
      locator: null,
    };
    const storage = createConversationArtifactStorage(observer.observed);
    NativeModules.OrotProviderDiagnostics = { enabled: true, report };
    f.delayWorker(async (sql) => {
      if (observer.isHeldQuery(sql)) await query.wait();
    });
    const projection = { calls: 0, hostMs: 0 };
    mockObserveProjection = (actual) => {
      if (clock.hasStarted('setup')) return actual();
      const started = clock.at();
      try {
        return actual();
      } finally {
        projection.calls += 1;
        projection.hostMs += clock.elapsed(started).hostMs;
      }
    };
    const input: Parameters<typeof storage.appendToolEvent>[0] = {
      ...syntheticTurn,
      event: {
        ...startedToolEvent,
        status: 'completed',
        sources: [reference],
        resultSummary: { referenceCount: 1 },
      },
      dependencies: [
        {
          reference,
          records: [{ kind: 'health_observation', id: record.id, revision: fingerprint(record) }],
        },
      ],
    };
    const started = clock.at();
    append = storage.appendToolEvent(input);
    await setup.entered;
    clock.release(setup, 23);
    await admitted.entered;
    expect(clock.hasStarted('body')).toBe(false);
    clock.release(admitted, 89);
    await query.entered;
    expect(clock.hasStarted('settlement')).toBe(false);
    clock.release(query, 47);
    await afterSql.entered;
    clock.release(afterSql, 31);
    await settlement.entered;
    const commits = f.events.filter((event) => event.event === 'COMMIT;').length;
    expect(clock.hasStarted('settlement')).toBe(true);
    clock.release(settlement, 59);
    await append;
    const total = clock.elapsed(started);
    expect(f.events.filter((event) => event.event === 'COMMIT;')).toHaveLength(commits + 1);
    const stages = Object.fromEntries(
      toolAppendPhases.map((phase) => [phase, clock.duration(phase)]),
    );
    const body = clock.duration('body');
    const sql = observer.sql();
    const otherBody = {
      heldTicks: body.heldTicks - sql.heldTicks,
      hostMs: body.hostMs - sql.hostMs,
    };
    // Lineage validation is nested in body and must not be subtracted twice.
    const exclusivePhases = toolAppendPhases.filter((phase) => phase !== 'lineage_validation');
    const outsideOwnedPhases = exclusivePhases.reduce((outside, phase) => {
      const time = clock.duration(phase);
      return {
        heldTicks: outside.heldTicks - time.heldTicks,
        hostMs: outside.hostMs - time.hostMs,
      };
    }, total);
    expect(outsideOwnedPhases.heldTicks).toBe(0);
    expect(projection.calls).toBe(1);
    expect(total.heldTicks).toBe(249);
    expect(stages).toMatchObject({
      setup: { heldTicks: 23 },
      decode: { heldTicks: 0 },
      admission: { heldTicks: 89 },
      body: { heldTicks: 78 },
      settlement: { heldTicks: 59 },
    });
    expect(sql.calls).toBeGreaterThan(0);
    expect(otherBody.hostMs).toBeGreaterThanOrEqual(0);
    expect(sql.heldTicks).toBe(47);
    expect(otherBody.heldTicks).toBe(31);
    expect(report.mock.calls).toHaveLength(toolAppendPhases.length * 2);
    expect(JSON.stringify(report.mock.calls)).not.toContain('synthetic-');
    console.info(
      'SYNTHETIC_TOOL_APPEND_ATTRIBUTION',
      JSON.stringify({
        total,
        projection,
        stages,
        awaitedSql: sql,
        otherBody,
        outsideOwnedPhases,
      }),
    );
    const saved = await warm.readToolCall(
      syntheticTurn.sessionId,
      startedToolEvent.operationRunId,
      startedToolEvent.callId,
    );
    expect(saved?.toolEvents).toEqual([expect.objectContaining({ status: 'completed' })]);
  } finally {
    setup.release();
    admitted.release();
    query.release();
    afterSql.release();
    settlement.release();
    mockObserveProjection = undefined;
    f.delayWorker();
    await Promise.allSettled([append, blocker]);
    NativeModules.OrotProviderDiagnostics = priorDiagnostics;
    await f.close();
  }
});
