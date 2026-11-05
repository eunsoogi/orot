import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVisitQuestionRecordRepository } from '../src';
import { openSqliteTestDatabase } from './sqliteTestDatabase';
import { setupAutomatic } from './visitQuestionAutomaticSupport';
import { evidenceSpan, sourceRecord } from './sourceEvidenceTestSupport';

test('clearing an AI answer is an explicit edit that survives reopen and reanalysis', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'visit-answer-edit-'));
  const path = join(directory, 'records.sqlite');
  const x = await setupAutomatic(path);
  try {
    const [saved] = await x.official.saveAutomatic(x.result, {
      loadCurrentInput: x.loadCurrentInput,
    });
    const edited = await x.official.edit({ id: saved.id, expectedRevision: 1, answer: null });
    expect(edited).toMatchObject({ editOrigin: 'user_edit', revision: 2, answer: null });
    x.close();
    const reopened = openSqliteTestDatabase(path);
    try {
      const official = createVisitQuestionRecordRepository(reopened.database);
      expect(await official.history(saved.id)).toEqual([saved, edited]);
      expect((await official.listForAppointment(x.result.appointmentId))[0]).toEqual(edited);
      let current!: Awaited<ReturnType<typeof x.loadCurrentInput>>;
      await reopened.database.transaction(async (sql) => {
        current = await x.loadCurrentInput(sql);
      });
      const revised = structuredClone(x.result);
      await reopened.database.transaction(async (sql) => {
        await sql.execute('UPDATE test_binding SET version = 2');
        current = await x.loadCurrentInput(sql);
      });
      revised.binding = current.binding;
      await expect(
        official.saveAutomatic(revised, { loadCurrentInput: x.loadCurrentInput }),
      ).rejects.toThrow('preserve the user edit');
      expect(await official.history(saved.id)).toEqual([saved, edited]);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('deleting evidence for a prepared question fences and removes its official record and history', async () => {
  const x = await setupAutomatic();
  try {
    const doc = sourceRecord('question-document', 'sha256:' + 'b'.repeat(64));
    await x.records.sourceRecords.create(doc);
    const span = await x.records.evidenceSpans.create(
      evidenceSpan('question-evidence', doc.id, {
        kind: 'text_range',
        startOffset: 0,
        endOffset: 4,
      }),
    );
    const question = (await x.records.get('visit_question', x.result.questions[0].questionId))!;
    await x.records.put('visit_question', { ...question, evidenceSpanIds: [span.id] });
    const record = await x.official.saveManual({
      appointmentId: x.result.appointmentId,
      questionId: question.id,
      expectedQuestionRevision: 'v1:2',
      answer: null,
    });
    const revised = structuredClone(x.result);
    revised.preparedQuestions[0].revision = 'v1:2';
    const [automatic] = await x.official.saveAutomatic(revised, {
      loadCurrentInput: x.loadCurrentInput,
    });
    expect(await x.records.listTypedSourceDeletionReferences(doc.id)).toEqual(
      expect.arrayContaining([
        { kind: 'visit_question_record', id: record.id },
        { kind: 'visit_question_record', id: automatic.id },
      ]),
    );
    await x.records.sourceRecords.delete(doc.id);
    expect(await x.official.listForAppointment(x.result.appointmentId)).toEqual([]);
    expect(await x.official.history(record.id)).toEqual([]);
    expect(await x.official.history(automatic.id)).toEqual([]);
    expect(await x.records.listDeletedSourceReferenceIds([record.id, automatic.id])).toEqual(
      [automatic.id, record.id].sort(),
    );
  } finally {
    x.close();
  }
});

test('manual confirmation rejects a newer question revision instead of returning the old wording', async () => {
  const x = await setupAutomatic();
  try {
    const id = x.result.questions[0].questionId;
    const saved = await x.official.saveManual({
      appointmentId: x.result.appointmentId,
      questionId: id,
      expectedQuestionRevision: 'v1:1',
      answer: null,
    });
    expect(saved.questionRevision).toBe('v1:1');
    const question = (await x.records.get('visit_question', id))!;
    await x.records.put('visit_question', { ...question, questionText: '수정된 질문' });
    await expect(
      x.official.saveManual({
        appointmentId: x.result.appointmentId,
        questionId: id,
        expectedQuestionRevision: 'v1:2',
        answer: null,
      }),
    ).rejects.toThrow('changed after confirmation');
    expect(await x.official.history(saved.id)).toEqual([saved]);
  } finally {
    x.close();
  }
});
