import { SafetyPolicyCategorySchema } from '@orot/domain';
import { encounterCanonical, runHealthReviewGraph } from '@orot/agent-runtime';
import type { HealthReviewPending } from '@orot/agent-runtime';
import { createHealthReviewPort } from '../../agent/healthReview/port';
import { syntheticHealthReview } from '../../agent/healthReview/syntheticFixture';
import { createHealthReviewInvocation } from '../evidenceInvocation';
import { healthReviewCheckpointKey } from '../requests';
import { healthReviewSqlite, safety } from '../testing/sqlite';

// Corrupt genuine graph output through the real source-linked saver, not an invented tuple API.
describe('Strict pending restoration from real graph checkpoints', () => {
  let f: Awaited<ReturnType<typeof healthReviewSqlite>>;
  beforeEach(async () => {
    f = await healthReviewSqlite();
  });
  afterEach(() => f.close());

  async function pending(safetyInput: unknown = {}) {
    const source = await f.requests.create('복원할 검토');
    const synthetic = syntheticHealthReview(f.repository, source.id, false);
    const port = createHealthReviewPort({
      sourceId: source.id,
      repository: f.repository,
      model: synthetic.model,
      evidence: createHealthReviewInvocation(f.data).evidence,
    });
    const collect = jest.spyOn(port, 'collect');
    const result = await runHealthReviewGraph({
      sourceId: source.id,
      threadId: source.id,
      safetyInput,
      port,
      checkpointer: f.saver(source.id),
    });
    if (result.status !== 'needs_clarification')
      throw new Error('Missing pending');
    const key = healthReviewCheckpointKey(source.id);
    const tuple = (await f.saver().getTuple(key))!;
    collect.mockClear();
    return { source, key, tuple, expected: result.pending, collect, synthetic };
  }

  it.each([
    ['safety_context', {}],
    ['evidence', safety],
  ])(
    'preserves the genuine %s snapshot exactly without discovery inference',
    async (reason, input) => {
      const value = await pending(input);
      expect(value.expected.reason).toBe(reason);
      expect(
        encounterCanonical(await f.requests.pending(value.source.id)),
      ).toBe(encounterCanonical(value.expected));
      expect((await f.requests.list())[0].pending).toEqual(value.expected);
      expect(value.collect).not.toHaveBeenCalled();
      expect(value.synthetic.modelCalls()).toBe(0);
    },
  );

  it.each(
    SafetyPolicyCategorySchema.options.filter(
      category => category !== 'insufficient_information',
    ),
  )(
    'rejects graph-impossible pending safety category %s in both saved locations',
    async category => {
      const value = await pending();
      const decision = { ...value.expected.safety, category };
      await f.saver(value.source.id).put(
        value.key,
        {
          ...value.tuple.checkpoint,
          channel_values: {
            ...value.tuple.checkpoint.channel_values,
            safety: decision,
            pending: { ...value.expected, safety: decision },
          },
        },
        value.tuple.metadata!,
        {},
      );
      expect(await f.requests.pending(value.source.id)).toBeNull();
      expect((await f.requests.list())[0].pending).toBeNull();
      expect(value.collect).not.toHaveBeenCalled();
      expect(value.synthetic.modelCalls()).toBe(0);
    },
  );

  it.each(['generatedSummary', 'unexpected', 'missingReason'])(
    'rejects malformed pending shape %s rather than stripping or returning it',
    async field => {
      const value = await pending();
      const malformed: Partial<HealthReviewPending> & Record<string, unknown> =
        { ...value.expected };
      if (field === 'missingReason') delete malformed.reason;
      else malformed[field] = 'Untrusted saved content';
      await f.saver(value.source.id).put(
        value.key,
        {
          ...value.tuple.checkpoint,
          channel_values: {
            ...value.tuple.checkpoint.channel_values,
            pending: malformed,
          },
        },
        value.tuple.metadata!,
        {},
      );
      expect(await f.requests.pending(value.source.id)).toBeNull();
      expect((await f.requests.list())[0].pending).toBeNull();
      expect(value.collect).not.toHaveBeenCalled();
      expect(value.synthetic.modelCalls()).toBe(0);
      // Reject without sanitizing or rewriting the user's saved checkpoint.
      expect(
        (await f.saver().getTuple(value.key))?.checkpoint.channel_values
          .pending,
      ).toEqual(malformed);
    },
  );
});
