import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createVisitQuestionRecordRepository,
  openEncryptedStorage,
  readVisitQuestionRevision,
} from '../src';
import { runMigrations } from '../src/migrations';
import { openSqliteTestDatabase } from './sqliteTestDatabase';
import { createOptions } from './manualHistoryTestSupport';
import type { VisitQuestion } from '@orot/domain';

const time = '2026-11-06T01:00:00Z';
const question: VisitQuestion = {
  id: 'prepared-question',
  appointmentId: 'visit-one',
  questionText: '약은 언제 복용하나요?',
  priority: 'routine',
  evidenceSpanIds: [],
  effectiveAt: time,
  recordedAt: time,
  ingestedAt: time,
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
};

async function setup(path = ':memory:') {
  const connection = openSqliteTestDatabase(path);
  const records = await openEncryptedStorage(createOptions(connection.database));
  await records.put('appointment', {
    id: 'visit-one',
    status: 'scheduled',
    effectiveAt: time,
    recordedAt: time,
    ingestedAt: time,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
  });
  await records.put('visit_question', question);
  const official = createVisitQuestionRecordRepository(connection.database, { clock: () => time });
  return { ...connection, records, official };
}

describe('official visit-question records', () => {
  it('does not turn a prepared candidate into an asked record before an explicit manual save', async () => {
    const { official, close } = await setup();
    try {
      expect(await official.listForAppointment('visit-one')).toEqual([]);
      const saved = await official.saveManual({
        appointmentId: 'visit-one',
        questionId: question.id,
        expectedQuestionRevision: 'v1:1',
        answer: null,
      });
      expect(saved).toMatchObject({ sourceMethod: 'manual_confirmed', answer: null, revision: 1 });
      expect(await official.listForAppointment('visit-one')).toEqual([saved]);
    } finally {
      close();
    }
  });

  it('reopens committed records and keeps append-only edit history with optimistic conflicts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'visit-record-reopen-'));
    const path = join(directory, 'database.sqlite');
    let connection = await setup(path);
    try {
      const saved = await connection.official.saveManual({
        appointmentId: 'visit-one',
        questionId: question.id,
        expectedQuestionRevision: 'v1:1',
        answer: '식후에 복용하세요.',
      });
      const edited = await connection.official.edit({
        id: saved.id,
        expectedRevision: 1,
        answer: null,
      });
      await expect(
        connection.official.edit({
          id: saved.id,
          expectedRevision: 1,
          answer: 'stale edit',
        }),
      ).rejects.toThrow('changed');
      expect(edited).toMatchObject({ revision: 2, editOrigin: 'user_edit', answer: null });
      connection.close();
      connection = await setup(path);
      expect(await connection.official.listForAppointment('visit-one')).toEqual([edited]);
      expect(await connection.official.history(saved.id)).toEqual([saved, edited]);
    } finally {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects stale or foreign visit questions and rolls back a failed history write', async () => {
    const { official, records, database, close } = await setup();
    try {
      await expect(
        official.saveManual({
          appointmentId: 'another-visit',
          questionId: question.id,
          expectedQuestionRevision: 'v1:1',
          answer: null,
        }),
      ).rejects.toThrow();
      await records.put('visit_question', { ...question, questionText: '수정한 질문' });
      await expect(
        official.saveManual({
          appointmentId: 'visit-one',
          questionId: question.id,
          expectedQuestionRevision: 'v1:1',
          answer: null,
        }),
      ).rejects.toThrow('changed');
      await records.put('visit_question', question);
      const revision = await readVisitQuestionRevision(database, question.id);
      await database.execute(
        "CREATE TRIGGER fail_visit_history BEFORE INSERT ON visit_question_record_history BEGIN SELECT RAISE(ABORT, 'history unavailable'); END",
      );
      await expect(
        official.saveManual({
          appointmentId: 'visit-one',
          questionId: question.id,
          expectedQuestionRevision: revision!,
          answer: null,
        }),
      ).rejects.toThrow('history unavailable');
      expect(await official.listForAppointment('visit-one')).toEqual([]);
      expect(await records.get('visit_question', question.id)).toEqual(question);
    } finally {
      close();
    }
  });

  it('initializes a version twelve question and retains its revision across reopen and ID reuse', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'visit-question-revision-'));
    const path = join(directory, 'database.sqlite');
    let connection = await setup(path);
    try {
      for (const name of ['visit_questions_revision_insert', 'visit_questions_revision_update'])
        await connection.database.execute(`DROP TRIGGER ${name}`);
      await connection.database.execute('DROP TABLE visit_question_revisions');
      await connection.database.execute('DROP TABLE visit_question_record_history');
      await connection.database.execute('DROP TABLE visit_question_records');
      await connection.database.execute('PRAGMA user_version = 12');
      connection.close();
      connection = openSqliteTestDatabase(path) as typeof connection;
      const original = connection.database;
      await expect(
        runMigrations({
          ...original,
          transaction: (operation) =>
            original.transaction((sql) =>
              operation({
                ...sql,
                execute: (query, values) => {
                  if (query.includes('CREATE TABLE IF NOT EXISTS visit_question_record_history'))
                    throw new Error('injected migration failure');
                  return sql.execute(query, values);
                },
              }),
            ),
        }),
      ).rejects.toThrow('injected migration failure');
      expect((await original.execute('PRAGMA user_version')).rows[0].user_version).toBe(12);
      expect(
        (
          await original.execute(
            "SELECT name FROM sqlite_master WHERE name = 'visit_question_revisions'",
          )
        ).rows,
      ).toEqual([]);
      expect(
        (await original.execute('SELECT id FROM visit_questions WHERE id = ?', [question.id])).rows,
      ).toHaveLength(1);
      await runMigrations(connection.database);
      expect(await readVisitQuestionRevision(connection.database, question.id)).toBe('v1:1');
      connection.close();
      const reopened = openSqliteTestDatabase(path);
      try {
        expect(await readVisitQuestionRevision(reopened.database, question.id)).toBe('v1:1');
        await reopened.database.execute('DELETE FROM visit_questions WHERE id = ?', [question.id]);
        const records = await openEncryptedStorage(createOptions(reopened.database));
        await records.put('visit_question', question);
        expect(await readVisitQuestionRevision(reopened.database, question.id)).toBe('v1:2');
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('removes retained revision identities during an all-local-data wipe', async () => {
    const { records, database, close } = await setup();
    try {
      await records.deleteAllLocalData();
      expect(
        (await database.execute('SELECT question_id FROM visit_question_revisions')).rows,
      ).toEqual([]);
      expect(await readVisitQuestionRevision(database, question.id)).toBeNull();
    } finally {
      close();
    }
  });
});
