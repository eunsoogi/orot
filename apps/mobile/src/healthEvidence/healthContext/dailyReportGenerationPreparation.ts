import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { acquireProtectedReadEpoch } from '../../storage/protectedReadEpoch';
import { ensureHealthContextGeneration } from './generation';

const structuralReady = new WeakMap<SqlDatabase, string>();
const structuralState = `SELECT schema_version, data_version,
  (SELECT 1 FROM health_context_generation WHERE singleton = 1) AS singleton
  FROM pragma_schema_version CROSS JOIN pragma_data_version`;

async function structuralStamp(tx: SqlExecutor) {
  try {
    const { rows } = await tx.execute(structuralState);
    const row = rows[0];
    if (
      rows.length !== 1 ||
      row?.singleton !== 1 ||
      ![row.schema_version, row.data_version].every(
        value =>
          typeof value === 'number' &&
          Number.isSafeInteger(value) &&
          value >= 0,
      )
    )
      return;
    return `${row.schema_version}:${row.data_version}`;
  } catch {
    // Missing schema/unsupported native probes use the unchanged setup path.
  }
}

/** Cache structural setup only for the exact admitted connection, not source
 * contents, their generation or a previous authorization decision. */
export function dailyReportGenerationPreparation(database: SqlDatabase) {
  let staged: string | undefined;
  let epoch: ReturnType<typeof acquireProtectedReadEpoch>;
  return {
    async reuse(tx: SqlExecutor): Promise<boolean> {
      const expected = structuralReady.get(database);
      if (!expected) return false;
      const probe = acquireProtectedReadEpoch(database);
      if (!probe) return false;
      try {
        // schema_version detects same-connection DDL; data_version alone cannot.
        // The live singleton check also catches same-connection removal.
        const actual = await structuralStamp(tx);
        return (
          probe.current() &&
          actual === expected &&
          structuralReady.get(database) === expected
        );
      } finally {
        probe.dispose();
      }
    },
    async prepare(tx: SqlExecutor) {
      await ensureHealthContextGeneration(tx);
      // Acquire after the last setup write. The still-owned guarded epoch must
      // survive any interleaving direct mutation and the native commit itself.
      epoch = acquireProtectedReadEpoch(database);
      if (epoch) staged = await structuralStamp(tx);
    },
    async transaction(
      operation: Parameters<SqlDatabase['transaction']>[0],
      current: () => boolean = () => true,
    ) {
      try {
        await database.transaction(operation);
        if (current() && staged && epoch?.current())
          structuralReady.set(database, staged);
      } finally {
        epoch?.dispose();
        epoch = undefined;
      }
    },
  };
}

/** Used by the Daily lookup that already prepares the generation schema. */
export async function prepareDailyReportGeneration(database: SqlDatabase) {
  const preparation = dailyReportGenerationPreparation(database);
  await preparation.transaction(preparation.prepare);
}
