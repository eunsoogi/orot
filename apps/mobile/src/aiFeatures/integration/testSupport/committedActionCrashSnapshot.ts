import type { SqlDatabase, SqlValue } from '@orot/storage';
const tables = [
  'langgraph_checkpoints',
  'langgraph_checkpoint_writes',
  'conversation_operation_journal',
] as const;

/** Synthetic crash cut: preserve actual SDK/SQLite bytes before the domain write,
 * then restore only those graph/journal tables after a synthetic run settles.
 * Domain records and atomic recovery markers remain committed. No process is killed.
 */
export async function committedActionCrashSnapshot(database: SqlDatabase) {
  const rows = await Promise.all(
    tables.map(
      async table => (await database.execute(`SELECT * FROM ${table}`)).rows,
    ),
  );
  return async () => {
    await database.transaction(async tx => {
      for (const table of tables) await tx.execute(`DELETE FROM ${table}`);
      for (const [index, table] of tables.entries()) {
        for (const row of rows[index]!) {
          const columns = Object.keys(row);
          await tx.execute(
            `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
            columns.map(column => row[column] as SqlValue),
          );
        }
      }
    });
  };
}
