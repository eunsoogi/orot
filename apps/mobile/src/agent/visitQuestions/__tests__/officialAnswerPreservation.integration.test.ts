import {
  createRecordRepository,
  createVisitQuestionRecordRepository,
  readVisitQuestionRevision,
  runMigrations,
} from '@orot/storage';
import type { VisitQuestionCreate } from '@orot/domain';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { saveReviewedVisitQuestions } from '../persistence';
import { localEvidenceFingerprint } from '../evidence';
import {
  appointment,
  candidate,
  evidenceSpan,
  input,
  repository,
  sourceRecord,
} from '../testing/persistenceFixtures';

const a = { ...candidate, identity: { id: 'question-a' } };
const b = {
  ...candidate,
  identity: { id: 'question-b' },
  questionText: '이 기록을 진료 때 어떻게 설명할까요?',
};
const snapshot = (rows: readonly VisitQuestionCreate[]) =>
  rows.map(row => ({ id: row.id, revision: localEvidenceFingerprint(row) }));
const review = (question: typeof a, row: VisitQuestionCreate) => ({
  ...question,
  identity: { id: row.id, expectedRevision: localEvidenceFingerprint(row) },
});

test('retains official answer history on preparation updates and removes it on explicit deletion', async () => {
  const opened = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(opened.database);
    const records = createRecordRepository(opened.database);
    const official = createVisitQuestionRecordRepository(opened.database, {
      clock: () => '2026-10-07T04:00:00.000Z',
    });
    await records.put('appointment', appointment);
    await records.put('source_record', sourceRecord as never);
    await records.put('evidence_span', evidenceSpan as never);
    const base = { ...input(repository()), repository: records };
    const saved = await saveReviewedVisitQuestions({
      ...base,
      questions: [a, b],
      expectedSavedQuestions: [],
    });
    const questionId = saved.questions[0]!.id;
    const revision = await readVisitQuestionRevision(
      opened.database,
      questionId,
    );
    expect(revision).toBe('v1:1');
    const confirmed = await official.saveManual({
      appointmentId: appointment.id,
      questionId,
      expectedQuestionRevision: revision!,
      answer: '원래 답변',
    });
    const edited = await official.edit({
      id: confirmed.id,
      expectedRevision: confirmed.revision,
      answer: '수정한 답변',
    });
    const expectedHistory = [confirmed, edited];
    const duplicate = await saveReviewedVisitQuestions({
      ...base,
      now: '2026-10-08T04:00:00.000Z',
      questions: [
        review(a, saved.questions[0]!),
        review(b, saved.questions[1]!),
      ],
      expectedSavedQuestions: snapshot(saved.questions),
    });
    expect(await official.history(confirmed.id)).toEqual(expectedHistory);
    expect(duplicate.questions).toEqual(saved.questions);
    expect(await readVisitQuestionRevision(opened.database, questionId)).toBe(
      revision,
    );
    const reordered = await saveReviewedVisitQuestions({
      ...base,
      questions: [
        review(b, duplicate.questions[1]!),
        review(a, duplicate.questions[0]!),
      ],
      expectedSavedQuestions: snapshot(duplicate.questions),
    });
    expect(await official.listForAppointment(appointment.id)).toEqual([edited]);
    expect(await official.history(confirmed.id)).toEqual(expectedHistory);
    const amended = await saveReviewedVisitQuestions({
      ...base,
      questions: [
        review(b, reordered.questions[0]!),
        {
          ...review(a, reordered.questions[1]!),
          questionText: '이 기록을 진료에서 어떻게 설명하면 좋을까요?',
        },
      ],
      expectedSavedQuestions: snapshot(reordered.questions),
    });
    expect(await readVisitQuestionRevision(opened.database, questionId)).toBe(
      'v1:3',
    );
    expect(await official.listForAppointment(appointment.id)).toEqual([edited]);
    expect(await official.history(confirmed.id)).toEqual(expectedHistory);
    await opened.database.execute(
      "CREATE TRIGGER fail_prepared_write BEFORE UPDATE ON visit_questions WHEN NEW.id = 'question-b' BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    );
    await expect(
      saveReviewedVisitQuestions({
        ...base,
        questions: [
          {
            ...review(b, amended.questions[0]!),
            questionText: '이 기록을 진료에서 어떤 방식으로 설명할까요?',
          },
        ],
        expectedSavedQuestions: snapshot(amended.questions),
      }),
    ).rejects.toThrow('injected failure');
    expect(await records.get('visit_question', questionId)).toEqual(
      amended.questions[1],
    );
    expect(
      await records.get('visit_question', amended.questions[0]!.id),
    ).toEqual(amended.questions[0]);
    expect(await official.listForAppointment(appointment.id)).toEqual([edited]);
    expect(await official.history(confirmed.id)).toEqual(expectedHistory);
    await opened.database.execute('DROP TRIGGER fail_prepared_write');
    await saveReviewedVisitQuestions({
      ...base,
      questions: [review(b, amended.questions[0]!)],
      expectedSavedQuestions: snapshot(amended.questions),
    });
    expect(await official.listForAppointment(appointment.id)).toEqual([]);
    expect(await official.history(confirmed.id)).toEqual([]);
  } finally {
    opened.close();
  }
});
