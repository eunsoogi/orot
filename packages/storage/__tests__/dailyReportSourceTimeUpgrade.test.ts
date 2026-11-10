import { openEncryptedStorage, runMigrations } from '../src';
import type { SqlDatabase } from '../src';
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

test.each([12, 13])('upgrades version %i preserving sources and report state', async (version) => {
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
  try {
    await repository.put('source_record', source);
    await restoreOldSourceSchema(database);
    if (version === 13) {
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
    expect((await database.execute('PRAGMA user_version')).rows[0].user_version).toBe(14);
    expect(await repository.get('source_record', source.id)).toEqual(source);
    expect((await database.execute('SELECT * FROM daily_report_heads')).rows).toHaveLength(
      version === 13 ? 1 : 0,
    );
    expect((await database.execute('SELECT * FROM daily_report_revisions')).rows).toHaveLength(
      version === 13 ? 1 : 0,
    );
  } finally {
    await database.closeAsync?.();
  }
});
