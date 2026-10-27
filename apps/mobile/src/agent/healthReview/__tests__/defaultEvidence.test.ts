import {
  createRecordRepository,
  runMigrations,
  createLangGraphCheckpointStorage,
} from '@orot/storage';
import {
  runHealthReviewGraph,
  SqliteCheckpointSaver,
} from '@orot/agent-runtime';
import type { HealthReviewOptions } from '@orot/agent-runtime';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import type { AiFeatureLocalData } from '../../../aiFeatures/integration/localData';
import { createHealthReviewEvidence } from '../evidence';
import { createHealthReviewPort } from '../port';
import {
  seedSyntheticHealthReview,
  syntheticHealthReview,
  syntheticReviewSafety,
} from '../syntheticFixture';
import {
  currentPeriodEnd,
  currentPeriodSampleAt,
  measurementContext,
  setCurrentPeriodBoundary,
  withFixedDate,
} from '../testing/currentPeriodEvidenceFixture';

describe('Default health review tools and durable original evidence identity', () => {
  let connection: ReturnType<typeof openSqliteTestDatabase>;
  const sourceId = 'synthetic-default-review';
  const repository = () => createRecordRepository(connection.database);
  const data = (): AiFeatureLocalData => ({
    ...createLocalEvidenceData(connection.database),
    repository: createLocalHealthEvidenceRepository(connection.database),
    rag: {
      index: async () => undefined,
      search: async () => {
        throw new Error('Overview must not embed or rank');
      },
    },
    memoryStorage: { listRecords: async () => [] },
    loadMemoryRecords: async () => [],
  });
  const checkpointer = () =>
    new SqliteCheckpointSaver(
      createLangGraphCheckpointStorage(connection.database, {
        sourceRecordId: sourceId,
      }),
    );
  const setup = (saver: ReturnType<typeof checkpointer>) => {
    const synthetic = syntheticHealthReview(repository(), sourceId, false);
    const evidence = createHealthReviewEvidence(data());
    if (!evidence) throw new Error('Default evidence tools missing');
    const port = createHealthReviewPort({
      sourceId,
      repository: repository(),
      model: {
        ...synthetic.model,
        execution: {
          ...synthetic.model.execution,
          allowedScope: { sourceKinds: ['personal_record'] },
        },
      },
      evidence,
    });
    const options: HealthReviewOptions = {
      threadId: 'default',
      sourceId,
      safetyInput: syntheticReviewSafety,
      checkpointer: saver,
      port,
    };
    return {
      port,
      options,
      run: () => runHealthReviewGraph(options),
      synthetic,
    };
  };
  beforeEach(async () => {
    connection = openSqliteTestDatabase(':memory:');
    await runMigrations(connection.database);
    await seedSyntheticHealthReview(repository(), sourceId);
  });
  afterEach(() => connection.close());

  it('retains insufficient information for real empty-period aggregate receipts and survives registry reconstruction unchanged', async () => {
    const saver = checkpointer();
    const first = setup(saver);
    const pending = await first.run();
    expect(pending).toMatchObject({
      status: 'needs_clarification',
      pending: {
        reason: 'evidence',
        safety: { category: 'insufficient_information' },
      },
    });
    if (pending.status !== 'needs_clarification')
      throw new Error('Missing evidence interrupt');
    expect(pending.pending.references.length).toBeGreaterThan(0);
    expect(
      pending.pending.references.every(
        reference => !/^e\d+$/.test(reference.evidenceId),
      ),
    ).toBe(true);
    const restarted = setup(saver);
    expect(await restarted.run()).toEqual(pending);
    expect(restarted.synthetic.modelCalls()).toBe(0);
  });

  it.each(['change', 'delete', 'replace'] as const)(
    'rejects %s even when a new default registry reuses the same ordinal provider aliases',
    async mode => {
      const saver = checkpointer();
      const first = await setup(saver).run();
      if (first.status !== 'needs_clarification')
        throw new Error('Missing evidence interrupt');
      const row = await repository().get(
        'health_observation',
        sourceId + ':pulse:0',
      );
      if (!row) throw new Error('Missing synthetic observation');
      if (mode === 'change')
        await repository().put('health_observation', {
          ...row,
          value: { kind: 'quantity', amount: 90, unit: 'count/min' },
        });
      else {
        await repository().delete('health_observation', row.id);
        if (mode === 'replace')
          await repository().put('health_observation', {
            ...row,
            id: sourceId + ':replacement',
          });
      }
      const restarted = setup(saver);
      expect(
        await runHealthReviewGraph({
          ...restarted.options,
          clarification: {
            pending: first.pending,
            safetyInput: syntheticReviewSafety,
          },
        }),
      ).toEqual({ status: 'stale_evidence' });
      expect(restarted.synthetic.modelCalls()).toBe(0);
    },
  );

  it('uses real current-period samples as trend evidence without treating missing calendar days as zero', async () => {
    await withFixedDate(currentPeriodEnd, async () => {
      for (const row of await repository().list('health_observation'))
        await repository().put('health_observation', {
          ...row,
          effectiveAt: currentPeriodSampleAt,
        });
      const current = setup(checkpointer());
      const batch = await current.port.collect(new AbortController().signal);
      expect(batch.coverage.flatMap(coverage => coverage.gaps)).toEqual([]);
      expect(
        batch.items.some(
          item =>
            item.content.startsWith('health_context: ') &&
            item.content.includes('unrecorded_days_are_unknown'),
        ),
      ).toBe(true);
    });
  });

  it('includes an observation just before the current period end and excludes one at the end', async () => {
    await withFixedDate(currentPeriodEnd, async () => {
      await setCurrentPeriodBoundary(repository(), sourceId);
      const batch = await setup(checkpointer()).port.collect(
        new AbortController().signal,
      );
      const context = measurementContext(batch);
      expect(context.period.toExclusive).toBe(currentPeriodEnd);
      expect(context.quantities).toEqual([
        expect.objectContaining({
          concept: 'heart_rate',
          sampleCount: 1,
          latest: {
            amount: 70,
            occurredAt: currentPeriodSampleAt,
          },
        }),
      ]);
      expect(batch.coverage.flatMap(coverage => coverage.gaps)).toEqual([]);
    });
  });

  it.each([
    { sourceIds: ['selected-source'] },
    {
      timeRange: {
        fromInclusive: '2026-10-01T00:00:00Z',
        toExclusive: '2026-10-02T00:00:00Z',
      },
    },
  ])(
    'rejects narrowed scope before reading a restored health period',
    async restriction => {
      const initial = setup(checkpointer());
      const batch = await initial.port.collect(new AbortController().signal);
      const references = initial.port.references(batch);
      const original = data();
      const read = jest.fn(original.readHealthContext!);
      const restored = createHealthReviewEvidence({
        ...original,
        readHealthContext: read,
      });
      if (!restored) throw new Error('Default evidence tools missing');
      restored.restore?.(references);
      const result = await restored.trends.search({
        operationRunId: 'scoped-restart',
        operationKey: 'read',
        input: {
          days: 30,
          topics: ['measurements', 'symptoms'],
          detail: 'weekly',
        },
        allowedScope: { sourceKinds: ['personal_record'], ...restriction },
        resultLimit: 4,
        maxPayloadBytes: 32768,
        signal: new AbortController().signal,
      });
      expect(read).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        items: [],
        coverage: [
          {
            gaps: [
              'period_context_requires_unrestricted_personal_record_scope_use_scoped_raw_search',
            ],
          },
        ],
      });
    },
  );
});
