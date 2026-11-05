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

const fs = require('node:fs') as {
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
};
const os = require('node:os') as { tmpdir(): string };
const path = require('node:path') as { join(...parts: string[]): string };

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

test('preserves identities across duplicate save, reorder, edit and reopen', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'orot-question-identity-'),
  );
  const dbPath = path.join(directory, 'records.sqlite');
  let opened = openSqliteTestDatabase(dbPath);
  try {
    await runMigrations(opened.database);
    let records = createRecordRepository(opened.database);
    await records.put('appointment', appointment);
    await records.put('source_record', sourceRecord as never);
    await records.put('evidence_span', evidenceSpan as never);
    await opened.database.execute(
      'CREATE TABLE question_write_audit (kind TEXT NOT NULL)',
    );
    await opened.database.execute(
      "CREATE TRIGGER audit_question_update AFTER UPDATE ON visit_questions BEGIN INSERT INTO question_write_audit VALUES ('update'); END",
    );
    await opened.database.execute(
      "CREATE TRIGGER audit_question_delete AFTER DELETE ON visit_questions BEGIN INSERT INTO question_write_audit VALUES ('delete'); END",
    );
    const base = { ...input(repository()), repository: records };
    const a = await saveReviewedVisitQuestions({
      ...base,
      questions: [first, second],
      expectedSavedQuestions: [],
    });
    const retry = await saveReviewedVisitQuestions({
      ...base,
      questions: [
        reviewed(first, a.questions[0]!),
        reviewed(second, a.questions[1]!),
      ],
      expectedSavedQuestions: snapshot(a.questions),
    });
    expect(retry.questions).toEqual(a.questions);
    expect(
      (await opened.database.execute('SELECT kind FROM question_write_audit'))
        .rows,
    ).toEqual([]);
    const reordered = await saveReviewedVisitQuestions({
      ...base,
      questions: [
        reviewed(second, a.questions[1]!),
        reviewed(first, a.questions[0]!),
      ],
      expectedSavedQuestions: snapshot(a.questions),
    });
    const edited = await saveReviewedVisitQuestions({
      ...base,
      questions: [
        reviewed(second, reordered.questions[0]!),
        {
          ...reviewed(first, reordered.questions[1]!),
          questionText: '이 기록을 진료에서 어떻게 설명하면 좋을까요?',
        },
      ],
      expectedSavedQuestions: snapshot(reordered.questions),
    });
    expect(
      (
        await opened.database.execute(
          "SELECT kind FROM question_write_audit WHERE kind = 'delete'",
        )
      ).rows,
    ).toEqual([]);
    opened.close();
    opened = openSqliteTestDatabase(dbPath);
    records = createRecordRepository(opened.database);
    const rows = await records.list('visit_question');
    expect(
      rows.map(row => [
        row.id,
        row.appointmentId,
        row.position,
        row.questionText,
      ]),
    ).toEqual([
      ['question-a', appointment.id, 2, edited.questions[1]!.questionText],
      ['question-b', appointment.id, 1, second.questionText],
    ]);
  } finally {
    opened.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects stale, duplicate and foreign identities without changing either visit', async () => {
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
      questions: [first, second],
      expectedSavedQuestions: [],
    });
    const baseline = snapshot(saved.questions);
    const foreign = {
      ...saved.questions[0]!,
      id: 'foreign-id',
      appointmentId: 'other-visit',
    };
    await records.put('visit_question', foreign);
    const valid = reviewed(first, saved.questions[0]!);
    const attempts = [
      {
        questions: [valid],
        expectedSavedQuestions: [
          { ...baseline[0]!, revision: 'stale' },
          baseline[1]!,
        ],
      },
      { questions: [valid, valid], expectedSavedQuestions: baseline },
      {
        questions: [{ ...valid, identity: { id: foreign.id } }],
        expectedSavedQuestions: baseline,
      },
      { questions: [], expectedSavedQuestions: baseline },
    ];
    for (const attempt of attempts) {
      await expect(
        saveReviewedVisitQuestions({ ...base, ...attempt }),
      ).rejects.toThrow();
      expect(await records.list('visit_question')).toEqual(
        [foreign, ...saved.questions].sort((a, b) => a.id.localeCompare(b.id)),
      );
    }
    const unchanged = () => records.list('visit_question');
    const expected = [foreign, ...saved.questions].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    await expect(
      saveReviewedVisitQuestions({
        ...base,
        appointmentId: 'missing-visit',
        questions: [valid],
        expectedSavedQuestions: [],
      }),
    ).rejects.toThrow();
    await records.put('appointment', { ...appointment, status: 'cancelled' });
    await expect(
      saveReviewedVisitQuestions({
        ...base,
        questions: [valid],
        expectedSavedQuestions: baseline,
      }),
    ).rejects.toThrow();
    await records.put('appointment', appointment);
    await expect(
      saveReviewedVisitQuestions({
        ...base,
        questions: [valid],
        expectedSavedQuestions: baseline,
        revalidateEvidence: async () => false,
      }),
    ).rejects.toThrow();
    expect(await unchanged()).toEqual(expected);
    await opened.database.execute(
      "CREATE TRIGGER fail_question_b BEFORE UPDATE ON visit_questions WHEN NEW.id = 'question-b' BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    );
    await expect(
      saveReviewedVisitQuestions({
        ...base,
        questions: [reviewed(second, saved.questions[1]!), valid],
        expectedSavedQuestions: baseline,
      }),
    ).rejects.toThrow('injected failure');
    expect(await unchanged()).toEqual(expected);
  } finally {
    opened.close();
  }
});
