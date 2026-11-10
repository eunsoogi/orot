import { createVisitQuestionRecordRepository, openEncryptedStorage, runMigrations } from '../src';
import type { SqlDatabase, SqlTransaction } from '../src';
import { createDatabase, options } from './sourceEvidenceTestSupport';

/** Recreate the old timestamp constraints while preserving real SQLite triggers and indexes. */
async function restoreOldSourceSchema(database: SqlDatabase) {
  await database.transaction(async (tx) => {
    const schema = await tx.execute(
      "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND (type = 'trigger' OR (type = 'index' AND tbl_name IN ('source_records', 'evidence_spans'))) ORDER BY type, name",
    );
    for (const row of schema.rows)
      if (row.type === 'trigger') await tx.execute(`DROP TRIGGER "${row.name}"`);
    for (const table of ['source_records', 'evidence_spans']) {
      await tx.execute(
        `CREATE TABLE ${table}_old (id TEXT PRIMARY KEY NOT NULL, effective_at TEXT NOT NULL, recorded_at TEXT NOT NULL, ingested_at TEXT NOT NULL, payload_json TEXT NOT NULL CHECK (json_valid(payload_json)))`,
      );
      await tx.execute(`INSERT INTO ${table}_old SELECT * FROM ${table}`);
      await tx.execute(`DROP TABLE ${table}`);
      await tx.execute(`ALTER TABLE ${table}_old RENAME TO ${table}`);
    }
    for (const row of schema.rows) await tx.execute(String(row.sql));
  });
}

test.each([12, 13, 14])(
  'upgrades version %i preserving sources and report state',
  async (version) => {
    const database = createDatabase();
    const repository = await openEncryptedStorage(options(database));
    const source = {
      id: 'synthetic-source',
      sourceKind: 'medical_document' as const,
      ingestedAt: '2026-01-01T00:00:00Z',
      effectiveAt: '2026-01-01T00:00:00Z',
      recordedAt: '2026-01-01T00:00:00Z',
      provenance: { origin: 'imported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
    };
    const official = createVisitQuestionRecordRepository(database, {
      clock: () => source.ingestedAt,
    });
    let recap: Awaited<ReturnType<typeof official.saveManual>> | undefined;
    try {
      await repository.put('source_record', source);
      if (version === 14) {
        const metadata = {
          effectiveAt: source.ingestedAt,
          recordedAt: source.ingestedAt,
          ingestedAt: source.ingestedAt,
          provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
          reviewState: { status: 'unreviewed' as const },
        };
        await repository.put('appointment', {
          ...metadata,
          id: 'synthetic-visit',
          status: 'scheduled',
        });
        await repository.put('visit_question', {
          ...metadata,
          id: 'synthetic-question',
          appointmentId: 'synthetic-visit',
          questionText: 'Synthetic question?',
          priority: 'routine',
          evidenceSpanIds: [],
        });
        recap = await official.saveManual({
          appointmentId: 'synthetic-visit',
          questionId: 'synthetic-question',
          expectedQuestionRevision: 'v1:1',
          answer: 'Synthetic answer',
        });
      }
      await restoreOldSourceSchema(database);
      if (version < 14) {
        // Version 14 introduced these tables and their triggers; do not let newer schema mask creation.
        const triggers = await database.execute(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND (sql LIKE '%visit_question_records%' OR sql LIKE '%visit_question_revisions%' OR sql LIKE '%visit_question_record_history%')",
        );
        for (const row of triggers.rows) await database.execute(`DROP TRIGGER "${row.name}"`);
        await database.execute('DROP TABLE visit_question_record_history');
        await database.execute('DROP TABLE visit_question_records');
        await database.execute('DROP TABLE visit_question_revisions');
        expect(
          (
            await database.execute(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'visit_question_records'",
            )
          ).rows,
        ).toEqual([]);
      }
      if (version >= 13) {
        await database.execute('INSERT INTO daily_report_heads VALUES (?, ?, ?, ?)', [
          'synthetic-day',
          'run',
          1,
          0,
        ]);
        await database.execute('INSERT INTO daily_report_revisions VALUES (?, ?, ?)', [
          'synthetic-day',
          1,
          'run',
        ]);
      } else {
        await database.execute('DROP TABLE daily_report_heads');
        await database.execute('DROP TABLE daily_report_revisions');
      }
      await database.execute(`PRAGMA user_version = ${version}`);
      await runMigrations(database);
      expect(
        (
          await database.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'visit_question_record_history'",
          )
        ).rows,
      ).toHaveLength(1);
      expect((await database.execute('PRAGMA user_version')).rows[0].user_version).toBe(16);
      expect(await repository.get('source_record', source.id)).toEqual(source);
      expect((await database.execute('SELECT * FROM daily_report_heads')).rows).toHaveLength(
        version >= 13 ? 1 : 0,
      );
      expect((await database.execute('SELECT * FROM daily_report_revisions')).rows).toHaveLength(
        version >= 13 ? 1 : 0,
      );
      expect((await database.execute('SELECT id FROM visit_question_records')).rows).toHaveLength(
        version === 14 ? 1 : 0,
      );
      if (recap) expect(await official.listForAppointment('synthetic-visit')).toEqual([recap]);
    } finally {
      await database.closeAsync?.();
    }
  },
);

test('rolls back the partial version fourteen rebuild without changing version or report data', async () => {
  const database = createDatabase();
  await openEncryptedStorage(options(database));
  try {
    await restoreOldSourceSchema(database);
    await database.execute("INSERT INTO daily_report_heads VALUES ('synthetic-day', 'run', 1, 0)");
    await database.execute('PRAGMA user_version = 13');
    const failing: SqlDatabase = {
      ...database,
      transaction(operation) {
        return database.transaction((transaction) => {
          const wrapped: SqlTransaction = {
            ...transaction,
            execute(query, parameters) {
              if (query.startsWith('CREATE TABLE evidence_spans_v15')) {
                throw new Error('injected migration interruption');
              }
              return transaction.execute(query, parameters);
            },
          };
          return operation(wrapped);
        });
      },
    };
    await expect(runMigrations(failing)).rejects.toThrow('injected migration interruption');
    expect((await database.execute('PRAGMA user_version')).rows[0].user_version).toBe(13);
    expect((await database.execute('SELECT identity_key FROM daily_report_heads')).rows).toEqual([
      { identity_key: 'synthetic-day' },
    ]);
    const columns = await database.execute('PRAGMA table_info(source_records)');
    expect(columns.rows.find((row) => row.name === 'effective_at')?.notnull).toBe(1);
    await runMigrations(database);
    expect((await database.execute('PRAGMA user_version')).rows[0].user_version).toBe(16);
  } finally {
    await database.closeAsync?.();
  }
});
