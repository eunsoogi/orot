import {
  createLangGraphCheckpointStorage,
  createRecordRepository,
  runMigrations,
} from '@orot/storage';
import {
  SqliteCheckpointSaver,
  runHealthReviewGraph,
} from '@orot/agent-runtime';
import type {
  HealthReviewOptions,
  HealthReviewPending,
} from '@orot/agent-runtime';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createHealthReviewPort } from '../port';
import {
  seedSyntheticHealthReview,
  syntheticHealthReview,
  syntheticReviewSafety,
} from '../syntheticFixture';
import { SqlCipherAgentMemoryStorage } from '../../../storage/agentMemoryStorage';

const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const sourceId = 'synthetic-health-review';
const config = { configurable: { thread_id: 'health-review:thread' } };

describe('Health review app adapter with actual policy, tools, model runtime and persistent graph', () => {
  let directory: string;
  let file: string;
  let handle: ReturnType<typeof openSqliteTestDatabase>;
  const repository = () => createRecordRepository(handle.database);
  const saver = () =>
    new SqliteCheckpointSaver(
      createLangGraphCheckpointStorage(handle.database, {
        sourceRecordId: sourceId,
      }),
    );
  const run = (
    input: {
      safetyInput?: unknown;
      clarification?: { pending: HealthReviewPending; safetyInput: unknown };
      signal?: AbortSignal;
      setup?: (synthetic: ReturnType<typeof syntheticHealthReview>) => void;
    } = {},
  ) => {
    const synthetic = syntheticHealthReview(repository(), sourceId, true);
    input.setup?.(synthetic);
    const options: HealthReviewOptions = {
      threadId: 'thread',
      sourceId,
      safetyInput: input.safetyInput ?? {},
      clarification: input.clarification,
      signal: input.signal,
      checkpointer: saver(),
      port: createHealthReviewPort({
        sourceId,
        repository: repository(),
        ...synthetic,
      }),
    };
    return { result: runHealthReviewGraph(options), synthetic, options };
  };
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'orot-health-review-'));
    file = join(directory, 'records.sqlite');
    handle = openSqliteTestDatabase(file);
    await runMigrations(handle.database);
    await new SqlCipherAgentMemoryStorage(
      handle.database,
    ).listRemovedSourceIds();
    await seedSyntheticHealthReview(repository(), sourceId);
  });
  afterEach(() => {
    handle.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('persists an actual clarification interrupt then resumes after reopening SQLite', async () => {
    const first = run();
    const result = await first.result;
    expect(result.status).toBe('needs_clarification');
    if (result.status !== 'needs_clarification')
      throw new Error('Missing interrupt');
    expect(result.pending.safety.category).toBe('insufficient_information');
    expect(first.synthetic.modelCalls()).toBe(0);
    expect(first.synthetic.toolCalls()).toBe(0);
    handle.close();
    handle = openSqliteTestDatabase(file);
    expect(await run().result).toEqual(result);
    const resumed = run({
      clarification: {
        pending: result.pending,
        safetyInput: syntheticReviewSafety,
      },
    });
    const review = await resumed.result;
    expect(review.status).toBe('review');
    expect(resumed.synthetic.modelCalls()).toBe(1);
    expect(resumed.synthetic.toolCalls()).toBe(2);
    if (review.status !== 'review') throw new Error('Missing review');
    expect(review.safety.category).toBe('no_triggered_action');
    expect(review.review.observedChanges[0].evidenceIds).toEqual([
      'trends',
      'records',
    ]);
    expect(review.review.unresolvedItems).toHaveLength(1);
    expect(review.review.questions).toHaveLength(1);
    const tuple = await saver().getTuple(config);
    expect(tuple?.checkpoint.channel_values.references).toHaveLength(2);
    expect(JSON.stringify(tuple?.checkpoint.channel_values)).not.toContain(
      '합성 심박 기록을 확인했어요.',
    );
    expect(await run().result).toEqual({ status: 'unavailable' });
  });

  it('applies real emergency policy before any tool or inference and cannot dispatch a model override', async () => {
    const urgent = run({
      safetyInput: {
        ...syntheticReviewSafety,
        readings: [{ ...syntheticReviewSafety.readings[0], systolicMmHg: 190 }],
        symptomAssessment: { status: 'warning_signs', signs: ['chest_pain'] },
      },
    });
    expect(await urgent.result).toMatchObject({
      status: 'safety_action',
      safety: {
        category: 'immediate_help',
        requiredActions: ['seek_immediate_emergency_help'],
      },
    });
    expect(urgent.synthetic.modelCalls()).toBe(0);
    expect(urgent.synthetic.toolCalls()).toBe(0);
  });

  it('retains insufficient information when either structured trends or personal evidence is missing', async () => {
    const pending = run({
      safetyInput: syntheticReviewSafety,
      setup: synthetic => {
        synthetic.evidence.trends.search = async () => ({
          items: [],
          conflicts: [],
          coverage: [
            {
              sourceKind: 'personal_record',
              searchedSourceIds: [],
              gaps: [],
              truncated: false,
              resultLimit: 1,
              returnedCount: 0,
            },
          ],
        });
      },
    });
    expect(await pending.result).toMatchObject({
      status: 'needs_clarification',
      pending: {
        reason: 'evidence',
        safety: { category: 'insufficient_information' },
      },
    });
    expect(pending.synthetic.modelCalls()).toBe(0);
  });

  it('rejects mismatched clarification snapshots and preserves a second insufficient-information interrupt', async () => {
    const first = await run().result;
    if (first.status !== 'needs_clarification')
      throw new Error('Missing interrupt');
    const forged = run({
      clarification: {
        pending: { ...first.pending, sourceId: 'other' },
        safetyInput: syntheticReviewSafety,
      },
    });
    expect(await forged.result).toEqual({ status: 'stale_evidence' });
    expect(forged.synthetic.modelCalls()).toBe(0);
    const stillMissing = await run({
      clarification: { pending: first.pending, safetyInput: {} },
    }).result;
    expect(stillMissing).toMatchObject({
      status: 'needs_clarification',
      pending: { safety: { category: 'insufficient_information' } },
    });
  });

  it('erases the checkpoint on logical source removal and rejects late clarification before model dispatch', async () => {
    const first = await run().result;
    if (first.status !== 'needs_clarification')
      throw new Error('Missing interrupt');
    await new SqlCipherAgentMemoryStorage(handle.database).markSourceRemoved(
      sourceId,
    );
    expect(await saver().getTuple(config)).toBeUndefined();
    const removed = run({
      clarification: {
        pending: first.pending,
        safetyInput: syntheticReviewSafety,
      },
    });
    expect(await removed.result).toEqual({ status: 'unavailable' });
    expect(removed.synthetic.modelCalls()).toBe(0);
  });

  it('rejects source changes during inference and caller cancellation without publishing review prose', async () => {
    const changed = run({
      safetyInput: syntheticReviewSafety,
      setup: synthetic => {
        const generate = synthetic.model.provider.generate;
        synthetic.model.provider.generate = async request => {
          const answer = await generate(request);
          await repository().delete(
            'health_observation',
            sourceId + ':pulse:0',
          );
          return answer;
        };
      },
    });
    expect((await changed.result).status).toBe('stale_evidence');
    const controller = new AbortController();
    controller.abort();
    expect(await run({ signal: controller.signal }).result).toEqual({
      status: 'cancelled',
    });
  });

  it('keeps remote model consent authoritative for the exact outbound health payload', async () => {
    const remote = run({
      safetyInput: syntheticReviewSafety,
      setup: synthetic => {
        Object.assign(synthetic.model, {
          execution: {
            ...synthetic.model.execution,
            remoteProcessing: true,
            recipient: 'selected-account',
          },
        });
      },
    });
    expect((await remote.result).status).toBe('stale_evidence');
    expect(remote.synthetic.modelCalls()).toBe(0);
    expect(remote.synthetic.toolCalls()).toBe(2);
  });
});
