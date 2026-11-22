import type { AgentMemoryService } from '@orot/agent-memory';
import type { VisitQuestion } from '@orot/domain';
import type { visitHealthFixture } from '../../agent/visitQuestions/testing/healthContextFixture';
import { now } from '../../agent/visitQuestions/testing/persistenceFixtures';
import { readVisitPeriodPolicy } from '../../storage/legacyVisitPeriodQuarantine';
import { decodeAgentMemoryRecord } from '../../storage/agentMemoryStorageRecords';

type Fixture = Awaited<ReturnType<typeof visitHealthFixture>>;
const firstReviewTime = Date.parse(now);
const laterReviewTime = firstReviewTime + 60_000;

/** A no-period first review keeps its ordinary identity long enough for a
 * source-backed re-review to exercise Rememori's actual same-key replacement. */
export async function saveHistoricalVisitReplacement(
  original: Fixture,
  memory: AgentMemoryService,
) {
  async function snapshot() {
    const result = await original.database.execute(
      'SELECT record_json FROM agent_memory_records',
    );
    expect(result.rows).toHaveLength(1);
    return decodeAgentMemoryRecord(result.rows[0]?.record_json);
  }
  const clock = jest.spyOn(Date, 'now').mockReturnValue(firstReviewTime);
  try {
    const first = await original.save({
      memory,
      questions: [
        { ...original.question, kind: 'clarification', citations: [] },
      ],
    });
    expect(first.memoryStatus).toBe('saved');
    const initial = await snapshot();
    clock.mockReturnValue(laterReviewTime);
    const reviewedAt = new Date(laterReviewTime).toISOString();
    const replacement = await original.save({
      memory,
      now: reviewedAt,
      questions: [
        {
          ...original.question,
          questionText: '다시 검토한 합성 질문인가요?',
        },
      ],
    });
    expect(replacement.memoryStatus).toBe('saved');
    const persisted = await snapshot();
    expect(persisted.id).not.toBe(initial.id);
    expect(persisted.createdAt).toBe(initial.createdAt);
    expect(persisted.createdAt).toBeLessThan(laterReviewTime);
    expect(replacement.questions[0]?.reviewState).toMatchObject({
      status: 'reviewed',
      reviewerId: 'local-user',
      reviewedAt,
    });
    expect(persisted.text).toContain('다시 검토한 합성 질문인가요?');
    return replacement;
  } finally {
    clock.mockRestore();
  }
}

/** Simulate a restored store missing current period policy, not the separate
 * atomic memory attestation. The real legacy audit rejects the drifted evidence. */
export async function restoreWithoutCurrentVisitPeriod(
  original: Fixture,
  question: VisitQuestion,
) {
  await original.database.execute(
    'DELETE FROM visit_period_policy WHERE question_id=?',
    [question.id],
  );
  expect(await readVisitPeriodPolicy(original.records, question)).toBe(false);
  expect(
    (
      await original.database.execute(
        'SELECT memory_id FROM memory_period_attestation',
      )
    ).rows,
  ).toHaveLength(1);
}
