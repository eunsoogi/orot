import type { SqlDatabase } from '@orot/storage';
import { aliasStepAnchorConnection } from './workoutStepAnchorSql';
import {
  settleKnownIndependentRead,
  type ReadSettlement,
} from './independentReadSettlement';
export type ProtectedReadEpoch = {
  readonly ownerIdentity: object;
  active: number;
  mutation: number;
  workoutMutation: number;
  pendingStepAnchors: number;
  pending: number;
  dirtyTransactions: number;
  unsettledFailure?: boolean;
  detached?: boolean;
  settleListeners?: Set<() => void>;
  preDispatchRetirements?: Set<() => void>;
};
const epochs = new WeakMap<SqlDatabase, ProtectedReadEpoch>();
export function attachProtectedReadEpoch(
  database: SqlDatabase,
  epoch: ProtectedReadEpoch,
) {
  epochs.set(database, epoch);
}
export function aliasProtectedReadEpoch(
  owner: SqlDatabase,
  facade: SqlDatabase,
) {
  const epoch = epochs.get(owner);
  if (epoch) epochs.set(facade, epoch);
  aliasStepAnchorConnection(owner, facade);
}
export function independentReadMutation(owner: SqlDatabase) {
  const e = epochs.get(owner);
  if (
    e &&
    !e.detached &&
    !e.unsettledFailure &&
    !e.dirtyTransactions &&
    !e.pending
  )
    return e.mutation;
}
export function acquireProtectedReadEpoch(owner: SqlDatabase) {
  return acquireEpoch(owner, false);
}
/** A different native connection cannot see a dirty transaction until commit.
 * Same-connection protected algorithms keep their existing admission rules. */
export function acquireIndependentReadEpoch(owner: SqlDatabase) {
  return acquireEpoch(owner, true);
}
export function acquireWorkoutReadEpoch(owner: SqlDatabase) {
  return acquireEpoch(owner, true, true);
}
export function hasPendingStepAnchors(owner: SqlDatabase) {
  return (epochs.get(owner)?.pendingStepAnchors ?? 0) > 0;
}
function acquireEpoch(
  owner: SqlDatabase,
  independent: boolean,
  workout = false,
) {
  const epoch = epochs.get(owner);
  if (
    !epoch ||
    epoch.detached ||
    epoch.pending !== 0 ||
    (independent && (epoch.dirtyTransactions !== 0 || epoch.unsettledFailure))
  )
    return;
  epoch.active++;
  const mutation = () => (workout ? epoch.workoutMutation : epoch.mutation);
  const start = mutation();
  let active = true;
  const current = () =>
    active &&
    !epoch.detached &&
    start === mutation() &&
    (!independent ||
      (epoch.dirtyTransactions === 0 && !epoch.unsettledFailure));
  return {
    current,
    beforeDispatch(retire: () => void) {
      if (!independent || !current()) return;
      const listeners = (epoch.preDispatchRetirements ??= new Set());
      listeners.add(retire);
      return () => {
        listeners.delete(retire);
      };
    },
    dispose() {
      if (active) epoch.active--;
      active = false;
    },
  };
}
export function awaitIndependentReadSettlement(
  owner: SqlDatabase,
  timeoutMs: number | undefined,
  signal?: AbortSignal,
): Promise<boolean> {
  return readSettlement(
    owner,
    timeoutMs,
    signal,
    outcome => outcome === 'settled',
  );
}
export function awaitIndependentReadSettlementResult(
  owner: SqlDatabase,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  return readSettlement(owner, timeoutMs, signal, outcome => outcome);
}
function readSettlement<R>(
  owner: SqlDatabase,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
  result: (outcome: ReadSettlement) => R,
) {
  const epoch = epochs.get(owner);
  if (!epoch) return Promise.resolve(result('owner_missing'));
  return settleKnownIndependentRead(epoch, timeoutMs, signal, result);
}
export function protectedDatabaseOwnerIdentity(
  owner: SqlDatabase,
): object | undefined {
  return epochs.get(owner)?.ownerIdentity;
}
