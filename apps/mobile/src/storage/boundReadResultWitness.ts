import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import {
  acquireIndependentReadEpoch,
  acquireProtectedReadEpoch,
  protectedSqlRead,
} from './protectedReadEpoch';

const stampSql =
  'SELECT total_changes() AS local, schema_version, data_version FROM pragma_schema_version CROSS JOIN pragma_data_version';
export class BoundReadWitnessUnavailable extends Error {}

/** An owned read lost only its SQLite revision; its result is still invalid. */
export class BoundReadRevisionChanged extends BoundReadWitnessUnavailable {}

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
  options?: { readonly requireSettledOwner: boolean },
): BoundReadWitness | undefined {
  return createWitness(owner, stillOwned, options);
}

type BoundReadWitness = {
  current(): boolean;
  requireCurrent(): void;
  sample(tx: SqlExecutor): Promise<void>;
  wrap(tx: SqlExecutor): SqlExecutor;
  forkSettled(stillOwned: () => boolean): BoundReadWitness | undefined;
  beforeRetire(retire: () => void): (() => void) | undefined;
  dispose(): void;
};

function createWitness(
  owner: SqlDatabase,
  stillOwned: () => boolean,
  options?: { readonly requireSettledOwner: boolean },
  settledVersion?: string,
): BoundReadWitness | undefined {
  const epoch = options?.requireSettledOwner
    ? acquireIndependentReadEpoch(owner)
    : acquireProtectedReadEpoch(owner);
  if (!epoch) return;
  let version = settledVersion;
  const current = () => epoch.current() && stillOwned();
  const requireCurrent = () => {
    if (!stillOwned()) throw new BoundReadWitnessUnavailable();
    if (!epoch.current()) throw new BoundReadRevisionChanged();
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
      throw new BoundReadRevisionChanged();
    version ??= result;
  };
  return {
    current,
    requireCurrent,
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
    forkSettled(stillSettledOwner) {
      if (!current() || !options?.requireSettledOwner || version === undefined)
        return;
      return createWitness(owner, stillSettledOwner, options, version);
    },
    beforeRetire: epoch.beforeDispatch,
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
