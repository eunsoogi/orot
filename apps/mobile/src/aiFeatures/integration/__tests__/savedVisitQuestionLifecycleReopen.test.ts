import {
  createRecordRepository,
  createVisitQuestionRecordRepository,
  readVisitQuestionRevision,
} from '@orot/storage';
import { visitHealthFixture } from '../../../agent/visitQuestions/testing/healthContextFixture';
import { createHealthContextReader } from '../../../healthEvidence/healthContext/reader';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { loadSavedVisitQuestionState } from '../savedVisitQuestions';

test('reopens reviewed question order and visit-linked answer history after an edit', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-question-lifecycle-'));
  const path = join(directory, 'records.sqlite');
  const fixture = await visitHealthFixture('measurements', path);
  let originalOpen = true;
  try {
    const first = fixture.question;
    const second = {
      ...first,
      identity: { id: 'synthetic-second-question' },
      questionText: '합성 기록을 다음 진료에서 어떻게 살펴볼까요?',
    };
    await fixture.save({ questions: [first, second] });
    const official = createVisitQuestionRecordRepository(fixture.database);
    expect(
      await official.listForAppointment(fixture.prepared.appointment.id),
    ).toEqual([]);
    const revision = await readVisitQuestionRevision(
      fixture.database,
      first.identity.id,
    );
    if (!revision) throw new Error('The prepared question has no revision.');
    const answered = await official.saveManual({
      appointmentId: fixture.prepared.appointment.id,
      questionId: first.identity.id,
      expectedQuestionRevision: revision,
      answer: '합성 답변',
    });
    const corrected = await official.edit({
      id: answered.id,
      expectedRevision: answered.revision,
      answer: '수정한 합성 답변',
    });
    await fixture.save({
      questions: [
        second,
        { ...first, questionText: '수정한 합성 질문을 확인할까요?' },
      ],
    });
    fixture.close();
    originalOpen = false;
    const reopened = openSqliteTestDatabase(path);
    try {
      const records = createRecordRepository(reopened.database);
      const result = await loadSavedVisitQuestionState({
        appointmentId: fixture.prepared.appointment.id,
        records,
        sourceReader: createLocalHealthEvidenceRepository(reopened.database),
        readHealthContext: createHealthContextReader(reopened.database),
        registry: new LocalEvidenceReferenceRegistry(),
      });
      expect(result.status).toBe('ready');
      if (result.status !== 'ready')
        throw new Error('Saved questions did not restore.');
      expect(result.appointmentId).toBe(fixture.prepared.appointment.id);
      expect(result.questions.map(question => question.identity.id)).toEqual([
        second.identity.id,
        first.identity.id,
      ]);
      expect(result.questions[1]?.questionText).toBe(
        '수정한 합성 질문을 확인할까요?',
      );
      const restoredOfficial = createVisitQuestionRecordRepository(
        reopened.database,
      );
      expect(
        await restoredOfficial.listForAppointment(
          fixture.prepared.appointment.id,
        ),
      ).toEqual([corrected]);
      expect(await restoredOfficial.history(answered.id)).toEqual([
        answered,
        corrected,
      ]);
    } finally {
      reopened.close();
    }
  } finally {
    if (originalOpen) fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a transient read and a concurrent question deletion after reopen never erase or resurrect saved content', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-question-retry-'));
  const path = join(directory, 'records.sqlite');
  const fixture = await visitHealthFixture('measurements', path);
  let originalOpen = true;
  try {
    await fixture.save();
    fixture.close();
    originalOpen = false;
    const reopened = openSqliteTestDatabase(path);
    try {
      const records = createRecordRepository(reopened.database);
      const read = createHealthContextReader(reopened.database);
      const input = {
        appointmentId: fixture.prepared.appointment.id,
        records,
        sourceReader: createLocalHealthEvidenceRepository(reopened.database),
        registry: new LocalEvidenceReferenceRegistry(),
      };
      const before = await records.get(
        'visit_question',
        fixture.question.identity.id,
      );
      expect(before).not.toBeNull();
      const failed = await loadSavedVisitQuestionState({
        ...input,
        readHealthContext: async () => {
          throw new Error('Synthetic transient failure');
        },
      });
      expect(failed.status).toBe('error');
      expect(
        await records.get('visit_question', fixture.question.identity.id),
      ).toEqual(before);
      const retried = await loadSavedVisitQuestionState({
        ...input,
        readHealthContext: read,
      });
      expect(retried).toMatchObject({
        status: 'ready',
        questions: [
          {
            identity: { id: fixture.question.identity.id },
            questionText: fixture.question.questionText,
          },
        ],
      });
      expect(
        await records.get('visit_question', fixture.question.identity.id),
      ).toEqual(before);

      const raced = await loadSavedVisitQuestionState({
        ...input,
        readHealthContext: async (...args) => {
          const report = await read(...args);
          await records.delete('visit_question', fixture.question.identity.id);
          return report;
        },
      });
      expect(raced).toMatchObject({ status: 'error', questions: [] });
      expect(
        await records.get('visit_question', fixture.question.identity.id),
      ).toBeNull();
      expect(
        await loadSavedVisitQuestionState({
          ...input,
          readHealthContext: read,
        }),
      ).toMatchObject({
        status: 'ready',
        questions: [],
      });
    } finally {
      reopened.close();
    }
  } finally {
    if (originalOpen) fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
