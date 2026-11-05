import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { saveReviewedVisitQuestions } from '../../agent/visitQuestions/persistence';
import { localEvidenceFingerprint } from '../../agent/visitQuestions/evidence';
import {
  appointment,
  candidate,
  evidenceSpan,
  input,
  repository,
  sourceRecord,
} from '../../agent/visitQuestions/testing/persistenceFixtures';
import {
  createInlineVisitReview,
  inlineReviewToggle,
  inlineReviewUpdate,
} from '../inlineVisitReview';
import { createInlineVisitSave } from '../inlineVisitSave';
import type { VisitQuestionEvidenceItem } from '../../agent/visitQuestions/taskContract';

test('an inline selection persists edited questions for its actual visit in SQLite', async () => {
  const opened = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(opened.database);
    const records = createRecordRepository(opened.database);
    await records.put('appointment', appointment);
    await records.put('source_record', sourceRecord as never);
    await records.put('evidence_span', evidenceSpan as never);
    const existing = await saveReviewedVisitQuestions({
      ...input(repository()),
      repository: records,
    });
    const saved = {
      ...candidate,
      identity: {
        id: existing.questions[0]!.id,
        expectedRevision: localEvidenceFingerprint(existing.questions[0]),
      },
    };
    let review = createInlineVisitReview(
      'session:turn',
      [saved],
      [candidate],
      [],
      () => 'new-question',
    );
    review = inlineReviewToggle(review, 'new-question');
    review = inlineReviewUpdate(review, 'new-question', {
      questionText: '진료에서 이 내용을 자세히 어떻게 확인할까요?',
    });
    const persist = createInlineVisitSave<VisitQuestionEvidenceItem>(
      'session:turn',
      async selection => {
        const result = await saveReviewedVisitQuestions({
          ...input(repository()),
          repository: records,
          ...selection,
        });
        return {
          questions: selection.questions.map((question, index) => ({
            ...question,
            identity: {
              id: result.questions[index]!.id,
              expectedRevision: localEvidenceFingerprint(
                result.questions[index],
              ),
            },
          })),
          caveats: selection.caveats,
          memoryStatus: result.memoryStatus,
        };
      },
      () => true,
    );
    expect((await persist(review)).status).toBe('committed');
    const rows = (await records.list('visit_question')).sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0),
    );
    expect(
      rows.map(row => [row.id, row.appointmentId, row.questionText]),
    ).toEqual([
      [saved.identity.id, appointment.id, saved.questionText],
      [
        'new-question',
        appointment.id,
        '진료에서 이 내용을 자세히 어떻게 확인할까요?',
      ],
    ]);
  } finally {
    opened.close();
  }
});
