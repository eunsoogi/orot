import { createRecordRepository, runMigrations } from '@orot/storage';
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

const first = { ...candidate, identity: { id: 'question-a' } };
const second = {
  ...candidate,
  identity: { id: 'question-b' },
  questionText: '이 기록을 진료 때 어떻게 설명할까요?',
};
const snapshot = (rows: readonly VisitQuestionCreate[]) =>
  rows.map(row => ({ id: row.id, revision: localEvidenceFingerprint(row) }));
const reviewed = (question: typeof first, row: VisitQuestionCreate) => ({
  ...question,
  identity: { id: row.id, expectedRevision: localEvidenceFingerprint(row) },
});

test('a later same-ID reschedule never rewrites the date on an existing reviewed question', async () => {
  const opened = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(opened.database);
    const records = createRecordRepository(opened.database);
    await records.put('appointment', appointment);
    await records.put('source_record', sourceRecord as never);
    await records.put('evidence_span', evidenceSpan as never);
    const base = { ...input(repository()), repository: records };
    const saved = await saveReviewedVisitQuestions({
      ...base,
      questions: [first],
      expectedSavedQuestions: [],
    });
    const rescheduled = {
      ...appointment,
      status: 'rescheduled' as const,
      effectiveAt: '2026-10-30T09:00:00+09:00',
    };
    await records.put('appointment', rescheduled);
    const existing = reviewed(first, saved.questions[0]!);
    await expect(
      saveReviewedVisitQuestions({
        ...base,
        questions: [existing],
        expectedSavedQuestions: snapshot(saved.questions),
      }),
    ).rejects.toThrow('appointment changed');
    const remember = jest.fn(async () => 'synthetic-memory-id');
    const result = await saveReviewedVisitQuestions({
      ...base,
      memory: { remember },
      expectedAppointmentRevision: localEvidenceFingerprint(rescheduled),
      questions: [
        { ...existing, rationale: '의료진에게 진료 계획을 확인하는 이유.' },
        second,
      ],
      expectedSavedQuestions: snapshot(saved.questions),
    });
    expect(
      result.questions.map(row => [row.id, row.appointmentId, row.effectiveAt]),
    ).toEqual([
      [first.identity.id, appointment.id, appointment.effectiveAt],
      [second.identity.id, appointment.id, rescheduled.effectiveAt],
    ]);
    expect(remember).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          appointment.effectiveAt +
            ' 예약을 위해 검토한 질문:\n1. ' +
            first.questionText,
        ),
      }),
    );
    expect(remember).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          rescheduled.effectiveAt +
            ' 예약을 위해 검토한 질문:\n1. ' +
            second.questionText,
        ),
      }),
    );
    expect(
      await records.get('visit_question', first.identity.id),
    ).toMatchObject({
      appointmentId: appointment.id,
      effectiveAt: appointment.effectiveAt,
      rationale: '의료진에게 진료 계획을 확인하는 이유.',
    });
  } finally {
    opened.close();
  }
});
