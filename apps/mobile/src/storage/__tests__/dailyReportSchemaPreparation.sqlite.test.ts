import { createDailyReportIdentity } from '@orot/domain';
import { runMigrations, type SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportStorage } from '../dailyReportStorage';
import { agentMemoryDatabaseFacade } from '../agentMemoryDatabaseFacade';

const today = createDailyReportIdentity('2035-01-01', 'UTC');

async function seededReportStore(injectFailure?: () => void) {
  const sqlite = openSqliteTestDatabase(':memory:');
  const queries: string[] = [];
  try {
    await runMigrations(sqlite.database);
    const traced =
      (execute: SqlDatabase['execute']): SqlDatabase['execute'] =>
      async (sql, values) => {
        queries.push(sql);
        if (
          sql.includes('DROP TRIGGER IF EXISTS summary_manual_history_deleted')
        )
          injectFailure?.();
        return execute(sql, values);
      };
    const database = agentMemoryDatabaseFacade({
      execute: traced(sqlite.database.execute),
      transaction: operation =>
        sqlite.database.transaction(tx =>
          operation({ ...tx, execute: traced(tx.execute) }),
        ),
    });
    return { database, queries, sqlite };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

const counts = (queries: readonly string[]) => ({
  schema: queries.filter(query =>
    query.includes('DROP TRIGGER IF EXISTS summary_manual_history_deleted'),
  ).length,
  unrelatedList: queries.filter(query =>
    query.includes('SELECT r.id, r.created_at, r.model_name'),
  ).length,
  head: queries.filter(query =>
    query.startsWith('SELECT active_run_id, revision, deleted'),
  ).length,
});

test('shares schema setup on the exact facade, not Daily Report head data', async () => {
  const same = await seededReportStore();
  const separate = await seededReportStore();
  try {
    const current = () => createDailyReportStorage(same.database).lookup(today);
    const both = await Promise.all([current(), current()]);
    expect(both.map(value => value.status)).toEqual(['missing', 'missing']);
    expect(counts(same.queries)).toEqual({
      schema: 1,
      unrelatedList: 0,
      head: 2,
    });

    await same.sqlite.database.execute(
      'INSERT INTO daily_report_heads(identity_key, active_run_id, revision, deleted) VALUES (?, NULL, 1, 1)',
      [today.key],
    );
    expect((await current()).status).toBe('deleted');
    expect(counts(same.queries)).toEqual({
      schema: 1,
      unrelatedList: 0,
      head: 3,
    });

    expect(
      (await createDailyReportStorage(separate.database).lookup(today)).status,
    ).toBe('missing');
    expect(counts(separate.queries)).toEqual({
      schema: 1,
      unrelatedList: 0,
      head: 1,
    });
  } finally {
    separate.sqlite.close();
    same.sqlite.close();
  }
});

test('one failed initialization is shared but does not poison the next caller', async () => {
  let failed = true;
  const f = await seededReportStore(() => {
    if (failed) throw new Error('Synthetic schema setup interrupted');
  });
  try {
    const lookup = () => createDailyReportStorage(f.database).lookup(today);
    const both = await Promise.all([lookup(), lookup()]);
    expect(both.map(value => value.status)).toEqual(['error', 'error']);
    expect(counts(f.queries)).toEqual({ schema: 1, unrelatedList: 0, head: 0 });
    failed = false;
    expect((await lookup()).status).toBe('missing');
    expect(counts(f.queries)).toEqual({ schema: 2, unrelatedList: 0, head: 1 });
  } finally {
    f.sqlite.close();
  }
});
