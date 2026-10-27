import { runHealthReviewGraph } from '@orot/agent-runtime';
import { providerSuccess } from '@orot/model-runtime';
import { createHealthReviewPort } from '../../agent/healthReview/port';
import { syntheticHealthReview } from '../../agent/healthReview/syntheticFixture';
import { withFixedDate } from '../../agent/healthReview/testing/currentPeriodEvidenceFixture';
import { createHealthReviewInvocation } from '../evidenceInvocation';
import { healthReviewSqlite, instant, safety } from '../testing/sqlite';

describe('HealthKit-only graph and original alias readers', () => {
  let f: Awaited<ReturnType<typeof healthReviewSqlite>>;
  beforeEach(async () => {
    f = await healthReviewSqlite();
    await f.seed();
  });
  afterEach(() => f.close());

  it('reaches REVIEW with real-schema HealthKit-only evidence and keeps request name out of the payload', async () =>
    withFixedDate(instant, async () => {
      const source = await f.requests.create(
        'PRIVATE request name must never be sent',
      );
      const invocation = createHealthReviewInvocation(f.data);
      const synthetic = syntheticHealthReview(f.repository, source.id, false);
      const generate = jest.fn(async (request: unknown) => {
        expect(JSON.stringify(request)).not.toContain(source.title);
        expect(JSON.stringify(request)).not.toContain(source.id);
        const ids = [...invocation.aliases.keys()];
        return providerSuccess({
          text: JSON.stringify({
            type: 'result',
            citations: ids,
            value: {
              observedChanges: [
                {
                  text: '저장된 심박 측정 기록을 확인했어요.',
                  evidenceIds: ids,
                },
              ],
              unresolvedItems: ['기록이 없는 날은 알 수 없어요.'],
              questions: ['측정 당시 상황을 확인할까요?'],
            },
          }),
          toolCalls: [],
          finishReason: 'complete' as const,
        });
      });
      const model = {
        ...synthetic.model,
        provider: { ...synthetic.model.provider, generate },
        execution: {
          ...synthetic.model.execution,
          allowedScope: { sourceKinds: ['personal_record'] as const },
        },
      };
      const port = createHealthReviewPort({
        sourceId: source.id,
        repository: f.repository,
        model,
        evidence: invocation.evidence,
      });
      const result = await runHealthReviewGraph({
        sourceId: source.id,
        threadId: source.id,
        safetyInput: safety,
        port,
        checkpointer: f.saver(source.id),
      });
      expect(result.status).toBe('review');
      expect(generate).toHaveBeenCalledTimes(1);
      expect(await f.requests.pending(source.id)).toBeNull();
      expect(await f.repository.list('source_record')).toHaveLength(1);
      expect(await f.repository.list('evidence_span')).toEqual([]);
      const signal = new AbortController().signal;
      const reads = await Promise.all(
        [...invocation.aliases.values()].map(alias =>
          invocation.readSource(alias, signal),
        ),
      );
      expect(reads.every(read => read.status === 'available')).toBe(true);
      expect(
        reads.some(
          read =>
            read.status === 'available' &&
            read.document.sourceKind === 'health_context_period',
        ),
      ).toBe(true);
      expect(
        reads.some(
          read =>
            read.status === 'available' &&
            read.document.sourceKind === 'personal_record',
        ),
      ).toBe(true);
    }));

  it('uses the exact original alias for readSource and revalidates changed/deleted rows', async () =>
    withFixedDate(instant, async () => {
      const source = await f.requests.create('검토');
      const invocation = createHealthReviewInvocation(f.data);
      const synthetic = syntheticHealthReview(f.repository, source.id, false);
      const port = createHealthReviewPort({
        sourceId: source.id,
        repository: f.repository,
        model: {
          ...synthetic.model,
          execution: {
            ...synthetic.model.execution,
            allowedScope: { sourceKinds: ['personal_record'] },
          },
        },
        evidence: invocation.evidence,
      });
      const batch = await port.collect(new AbortController().signal);
      const signal = new AbortController().signal;
      const aliases = [...invocation.aliases.values()];
      expect(aliases).toHaveLength(batch.items.length);
      const foreign = createHealthReviewInvocation(f.data);
      expect(await foreign.readSource(aliases[0], signal)).toEqual({
        status: 'unavailable',
      });
      const canonical = invocation.evidence.resolve(aliases[0])!;
      expect(await invocation.readSource(canonical, signal)).toEqual({
        status: 'unavailable',
      });
      await f.repository.delete('health_observation', 'healthkit-pulse');
      const reads = await Promise.all(
        aliases.map(alias => invocation.readSource(alias, signal)),
      );
      expect(
        reads.every(
          read => read.status === 'changed' || read.status === 'missing',
        ),
      ).toBe(true);
    }));
});
