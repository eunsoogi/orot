import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import {
  acquireProtectedReadEpoch,
  protectedSqlRead,
} from './protectedReadEpoch';

const stampSql =
  'SELECT total_changes() AS local, schema_version, data_version FROM pragma_schema_version CROSS JOIN pragma_data_version';
export class BoundReadWitnessUnavailable extends Error {}

const stamp = async (tx: SqlExecutor) => {
  const { rows } = await tx.execute(stampSql);
  const values = rows[0] && [
    rows[0].local,
    rows[0].schema_version,
    rows[0].data_version,
  ];
  if (
    rows.length !== 1 ||
    !values?.every(
      value =>
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
    )
  )
    throw new BoundReadWitnessUnavailable();
  return values.join(':');
};

/** A stable native read witness for a speculative structural plan. No SQL
 * results, arguments or source values are memoized by the witness. */
export function createBoundReadResultWitness(
  owner: SqlDatabase,
  stillOwned: () => boolean,
) {
  const epoch = acquireProtectedReadEpoch(owner);
  if (!epoch) return;
  let version: string | undefined;
  const current = () => epoch.current() && stillOwned();
  const requireCurrent = () => {
    if (!current()) throw new BoundReadWitnessUnavailable();
  };
  const sample = async (tx: SqlExecutor) => {
    requireCurrent();
    let result: string;
    try {
      result = await stamp(tx);
    } catch {
      throw new BoundReadWitnessUnavailable();
    }
    requireCurrent();
    if (version !== undefined && version !== result)
      throw new BoundReadWitnessUnavailable();
    version ??= result;
  };
  return {
    current,
    sample,
    wrap(tx: SqlExecutor): SqlExecutor {
      return {
        async execute(sql, binds) {
          requireCurrent();
          // Do not dispatch any speculative state effect. Run the stock plan instead.
          if (!protectedSqlRead(sql)) throw new BoundReadWitnessUnavailable();
          return tx.execute(sql, binds);
        },
      };
    },
    dispose: epoch.dispose,
  };
}

export type BoundReadResultWitness = NonNullable<
  ReturnType<typeof createBoundReadResultWitness>
>;

/** Let the driver's native transaction commit on a refused speculative read;
 * do not roll back a separate same-connection mutation that just invalidated it. */
export async function guardedBoundTransaction(
  database: SqlDatabase,
  witness: BoundReadResultWitness,
  execute: (executor: SqlExecutor) => Promise<void>,
  observed?: (executor: SqlExecutor) => SqlExecutor,
) {
  let refused: BoundReadWitnessUnavailable | undefined;
  await database.transaction(async native => {
    const sql = observed?.(native) ?? native;
    try {
      await witness.sample(sql);
      await execute(witness.wrap(sql));
      await witness.sample(sql);
    } catch (error) {
      if (!(error instanceof BoundReadWitnessUnavailable)) throw error;
      refused = error;
    }
  });
  if (refused) throw refused;
}
