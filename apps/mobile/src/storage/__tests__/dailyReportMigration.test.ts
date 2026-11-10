import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';

test('upgrades version twelve without assigning daily identities to legacy summaries', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    await connection.database.execute('DROP TABLE daily_report_heads');
    await connection.database.execute('DROP TABLE daily_report_revisions');
    await connection.database.execute(
      'CREATE TABLE symptom_summary_runs (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, model_name TEXT NOT NULL, result_json TEXT NOT NULL)',
    );
    await connection.database.execute(
      'INSERT INTO symptom_summary_runs VALUES (?, ?, ?, ?)',
      ['legacy', '2035-01-01T00:00:00Z', 'legacy', '{}'],
    );
    await connection.database.execute('PRAGMA user_version = 12');
    await runMigrations(connection.database);
    expect(
      (await connection.database.execute('PRAGMA user_version')).rows[0]
        ?.user_version,
    ).toBe(14);
    expect(
      (
        await connection.database.execute(
          'SELECT id FROM symptom_summary_runs WHERE id = ?',
          ['legacy'],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await connection.database.execute(
          'SELECT run_id FROM daily_report_revisions',
        )
      ).rows,
    ).toHaveLength(0);
  } finally {
    connection.close();
  }
});
