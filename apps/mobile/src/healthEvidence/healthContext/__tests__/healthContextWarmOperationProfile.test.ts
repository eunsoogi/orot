import { runMigrations, type SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createHealthContextReader } from '../reader';
import { beginHealthContextReadOperation } from '../healthContextReadOperation';

// Synthetic SQL-count diagnostic: no user records or native adapter access.
test.each([1, 2, 3, 4, 5])('profiles %i already-warm windows', async count => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    let sql = 0;
    const database: SqlDatabase = {
      execute: (query, params) => {
        sql++;
        return f.database.execute(query, params);
      },
      transaction: operation =>
        f.database.transaction(tx =>
          operation({
            ...tx,
            execute: (query, params) => {
              sql++;
              return tx.execute(query, params);
            },
          }),
        ),
    };
    const base = createHealthContextReader(database);
    const windows = Array.from({ length: count }, (_, i) => ({
      fromInclusive: '2026-10-01T00:00:00Z',
      toExclusive: new Date(Date.UTC(2026, 9, 2 + i)).toISOString(),
      timeZone: 'UTC',
    }));
    for (const window of windows) await base(window, ['measurements']);
    sql = 0;
    for (const window of windows) await base(window, ['measurements']);
    const defaultSql = sql;
    const operation = beginHealthContextReadOperation(base)!;
    sql = 0;
    for (const window of windows)
      await operation.read(window, ['measurements']);
    const scopedSql = sql;
    operation.dispose();
    console.info(
      JSON.stringify({
        count,
        defaultSql,
        scopedSql,
        extraSql: scopedSql - defaultSql,
      }),
    );
    expect(defaultSql).toBe(count);
    expect(scopedSql).toBe(defaultSql);
  } finally {
    f.close();
  }
});
