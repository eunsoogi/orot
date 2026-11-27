type SettlementOwner = {
  pending: number;
  dirtyTransactions: number;
  detached?: boolean;
  unsettledFailure?: boolean;
  settleListeners?: Set<() => void>;
};

export type ReadSettlement =
  | 'settled'
  | 'owner_missing'
  | 'owner_detached'
  | 'settlement_failed'
  | 'wait_expired'
  | 'cancelled';

/** Classify inside the existing admission promise at the exact callback, before
 * native or JS work can alter the same guard in a subsequent microtask. */
export function settleKnownIndependentRead<R>(
  owner: SettlementOwner,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
  result: (outcome: ReadSettlement) => R,
): Promise<R> {
  if (timeoutMs === undefined && !signal)
    return Promise.resolve(result('cancelled'));
  const refusal = () =>
    signal?.aborted
      ? 'cancelled'
      : owner.detached
        ? 'owner_detached'
        : owner.unsettledFailure
          ? 'settlement_failed'
          : undefined;
  const initial = refusal();
  if (initial) return Promise.resolve(result(initial));
  if (owner.pending === 0 && owner.dirtyTransactions === 0)
    return Promise.resolve(result('settled'));
  const listeners = (owner.settleListeners ??= new Set());
  return new Promise(resolve => {
    const finish = (outcome: ReadSettlement) => {
      listeners.delete(settled);
      signal?.removeEventListener('abort', cancelled);
      clearTimeout(timer);
      resolve(result(outcome));
    };
    const settled = () => finish(refusal() ?? 'settled');
    const cancelled = () => finish('cancelled');
    // A mounted owner with an abort and its own lifetime boundary can wait for
    // actual writer settlement rather than turn a timeout into data failure.
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => finish('wait_expired'), timeoutMs);
    listeners.add(settled);
    signal?.addEventListener('abort', cancelled, { once: true });
  });
}
