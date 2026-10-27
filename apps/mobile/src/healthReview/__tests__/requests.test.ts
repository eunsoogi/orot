import { runHealthReviewGraph, encounterCanonical } from '@orot/agent-runtime';
import { createHealthReviewPort } from '../../agent/healthReview/port';
import { createHealthReviewInvocation } from '../evidenceInvocation';
import { syntheticHealthReview } from '../../agent/healthReview/syntheticFixture';
import { withFixedDate } from '../../agent/healthReview/testing/currentPeriodEvidenceFixture';
import {
  createHealthReviewRequests,
  healthReviewCheckpointKey,
} from '../requests';
import { readHealthReviewPending } from '../pending';
import { healthReviewSqlite, instant } from '../testing/sqlite';

describe('Real request storage and checkpoint discovery', () => {
  let f: Awaited<ReturnType<typeof healthReviewSqlite>>;
  beforeEach(async () => {
    f = await healthReviewSqlite();
  });
  afterEach(() => f.close());

  it('requires an explicit authored name and creates distinct genuine request notes without observations', async () => {
    await expect(f.requests.create('  ')).rejects.toThrow('name');
    const one = await f.requests.create(' 첫 검토 ');
    const two = await f.requests.create('첫 검토');
    expect(one.id).not.toBe(two.id);
    expect(one).toMatchObject({
      title: '첫 검토',
      sourceKind: 'user_note',
      effectiveAt: instant,
      recordedAt: instant,
      ingestedAt: instant,
      provenance: {
        origin: 'user_reported',
        sourceRecordIds: [],
        source: { system: 'orot.health-review-request' },
      },
    });
    expect(await f.repository.list('health_observation')).toEqual([]);
    expect((await f.requests.list()).map(row => row.pending)).toEqual([
      null,
      null,
    ]);
  });

  it('discovers only its request notes and restores exact pending without running graph, tools or model', async () => {
    const source = await f.requests.create('검토');
    await f.repository.put('source_record', {
      ...source,
      id: 'foreign',
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
    });
    const synthetic = syntheticHealthReview(f.repository, source.id, false);
    const invocation = createHealthReviewInvocation(f.data);
    const port = createHealthReviewPort({
      sourceId: source.id,
      repository: f.repository,
      model: synthetic.model,
      evidence: invocation.evidence,
    });
    const collect = jest.spyOn(port, 'collect');
    const result = await runHealthReviewGraph({
      sourceId: source.id,
      threadId: source.id,
      safetyInput: {},
      port,
      checkpointer: f.saver(source.id),
    });
    expect(result.status).toBe('needs_clarification');
    const discovery = createHealthReviewRequests(f.repository, f.saver());
    const rows = await discovery.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].pending).toEqual(
      result.status === 'needs_clarification' ? result.pending : null,
    );
    expect(collect).not.toHaveBeenCalled();
    expect(synthetic.modelCalls()).toBe(0);
    const tuple = await f
      .saver()
      .getTuple(healthReviewCheckpointKey(source.id));
    expect(encounterCanonical(tuple?.checkpoint.channel_values.pending)).toBe(
      encounterCanonical(rows[0].pending),
    );
    expect(readHealthReviewPending(tuple, 'other')).toBeNull();
    for (const pending of [
      null,
      {},
      { ...rows[0].pending, sourceId: 'other' },
      { ...rows[0].pending, references: [{}] },
    ]) {
      expect(
        readHealthReviewPending(
          {
            ...tuple!,
            checkpoint: {
              ...tuple!.checkpoint,
              channel_values: { ...tuple!.checkpoint.channel_values, pending },
            },
          },
          source.id,
        ),
      ).toBeNull();
    }
  });

  it('deletion retains imported observations and prevents late source-linked checkpoint writes', async () =>
    withFixedDate(instant, async () => {
      await f.seed();
      const source = await f.requests.create('検討');
      const synthetic = syntheticHealthReview(f.repository, source.id, false);
      const port = createHealthReviewPort({
        sourceId: source.id,
        repository: f.repository,
        model: synthetic.model,
        evidence: createHealthReviewInvocation(f.data).evidence,
      });
      await runHealthReviewGraph({
        sourceId: source.id,
        threadId: source.id,
        safetyInput: {},
        port,
        checkpointer: f.saver(source.id),
      });
      const tuple = await f
        .saver()
        .getTuple(healthReviewCheckpointKey(source.id));
      await f.repository.sourceRecords.delete(source.id);
      expect(
        await f.repository.get('health_observation', 'healthkit-pulse'),
      ).not.toBeNull();
      expect(
        await f.saver().getTuple(healthReviewCheckpointKey(source.id)),
      ).toBeUndefined();
      await expect(f.requests.pending(source.id)).rejects.toThrow();
      await expect(
        f
          .saver(source.id)
          .put(
            healthReviewCheckpointKey(source.id),
            tuple!.checkpoint,
            tuple!.metadata!,
            {},
          ),
      ).rejects.toThrow();
    }));
});
