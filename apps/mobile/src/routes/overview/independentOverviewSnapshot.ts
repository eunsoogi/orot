import type { SqlDatabase, SqlExecutor } from '@orot/storage';

export type OverviewReadOutcome = 'published' | 'discarded' | 'unavailable';

type OverviewReadOnlyHandle = SqlDatabase & { close(): void };

async function dataVersion(executor: SqlExecutor) {
  const { rows } = await executor.execute('PRAGMA data_version');
  const result = rows[0]?.data_version;
  return rows.length === 1 &&
    typeof result === 'number' &&
    Number.isSafeInteger(result)
    ? result
    : undefined;
}

/** No raw executor leaves this snapshot. The writer remains untouched and the
 * protected owner owns publication after this exact read-only lease is closed. */
export async function readIndependentOverviewSnapshot<T>(
  open: () => OverviewReadOnlyHandle,
  current: () => boolean,
  confirmProtection: () => Promise<boolean>,
  project: (tx: SqlExecutor) => Promise<T>,
  publish: (value: T) => void,
): Promise<OverviewReadOutcome> {
  if (!current()) return 'discarded';
  let reader: OverviewReadOnlyHandle | undefined;
  let result: { value: T } | undefined;
  let outcome: OverviewReadOutcome = 'unavailable';
  const check = () => {
    if (!current()) throw new Error('Overview read owner changed.');
  };
  try {
    reader = open();
    // Connection-local only: never spill a derived health sort to disk.
    await reader.execute('PRAGMA temp_store = MEMORY');
    check();
    const before = await dataVersion(reader);
    if (before !== undefined) {
      check();
      await reader.transaction(async nativeTx => {
        check();
        const tx: SqlExecutor = {
          async execute(sql, bindings) {
            check();
            const rows = await nativeTx.execute(sql, bindings);
            check();
            return rows;
          },
        };
        // The writer installs this schema and its guards before exposing storage;
        // a missing/replaced singleton stays on the original writer setup path.
        const ready = await tx.execute(
          'SELECT 1 AS ready FROM health_context_generation WHERE singleton = 1',
        );
        if (ready.rows[0]?.ready !== 1) return;
        result = { value: await project(tx) };
      });
      check();
      if (result) {
        outcome =
          before === (await dataVersion(reader)) ? 'published' : 'discarded';
      }
    }
  } catch {
    outcome = current() && !result ? 'unavailable' : 'discarded';
  }
  try {
    // Check UIApplication after the last async SQL. Do not let a slow native
    // protection event authorize fallback following an SQL/open error either.
    if (
      outcome !== 'discarded' &&
      (!current() || !(await confirmProtection()) || !current())
    )
      outcome = 'discarded';
  } catch {
    outcome = 'discarded';
  } finally {
    try {
      reader?.close();
    } catch {
      outcome = 'discarded';
    }
  }
  // Close is synchronous on pinned op-sqlite. Never yield between this final
  // writer/owner epoch check and delivering the projection to the route.
  if (!current()) return 'discarded';
  if (outcome === 'published' && result) publish(result.value);
  return outcome;
}
