import { runMigrations, STORAGE_TABLES } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { setupDailyReportPending } from '../dailyReportPendingSchema';

const kinds = [
  'health_observation',
  'symptom_entry',
  'dose_event',
  'appointment',
  'medication_definition',
  'medication_assertion',
] as const;
// Low-level migration/trigger tests use SQLite rows, not claims of valid domain evidence.
test.each(kinds)(
  'exact %s dependency purges on correction and deletion, preserving other identities',
  async kind => {
    const c = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(c.database);
      await c.database.transaction(setupDailyReportPending);
      const table = STORAGE_TABLES[kind].table;
      for (const operation of ['UPDATE', 'DELETE']) {
        await c.database.execute(
          `INSERT INTO ${table}(id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)`,
          [
            'synthetic-row',
            '2035-01-01T00:00:00Z',
            '2035-01-01T00:00:00Z',
            '2035-01-01T00:00:00Z',
            '{}',
          ],
        );
        const run = `${kind}-${operation}`;
        await c.database.execute(
          'INSERT INTO daily_report_pending VALUES (?, ?, ?, ?)',
          [run, 'identity', 'synthetic pending text', '{}'],
        );
        await c.database.execute(
          'INSERT INTO daily_report_pending_sources VALUES (?, ?, ?, ?)',
          [run, kind, 'synthetic-row', 'revision'],
        );
        await c.database.execute(
          'INSERT INTO daily_report_pending VALUES (?, ?, ?, ?)',
          [`other-${run}`, 'other', 'unrelated', '{}'],
        );
        await c.database.execute(
          operation === 'UPDATE'
            ? `UPDATE ${table} SET payload_json = '{"changed":true}' WHERE id = ?`
            : `DELETE FROM ${table} WHERE id = ?`,
          ['synthetic-row'],
        );
        expect(
          (
            await c.database.execute(
              'SELECT candidate_json FROM daily_report_pending WHERE run_id = ?',
              [run],
            )
          ).rows[0]?.candidate_json,
        ).toBeNull();
        expect(
          (
            await c.database.execute(
              'SELECT candidate_json FROM daily_report_pending WHERE run_id = ?',
              [`other-${run}`],
            )
          ).rows[0]?.candidate_json,
        ).toBe('unrelated');
        if (operation === 'UPDATE')
          await c.database.execute(`DELETE FROM ${table} WHERE id = ?`, [
            'synthetic-row',
          ]);
      }
      await c.database.transaction(setupDailyReportPending);
      expect(
        (
          await c.database.execute(
            'SELECT run_id FROM daily_report_pending_sources',
          )
        ).rows,
      ).toHaveLength(2);
    } finally {
      c.close();
    }
  },
);
