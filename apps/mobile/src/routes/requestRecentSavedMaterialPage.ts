import type { Dispatch, SetStateAction } from 'react';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import type { ConversationExecutionAdapter } from '../ragConversation/conversationExecutionLease';
import { BoundReadRevisionChanged } from '../storage/boundReadResultWitness';
import { recentPageSize } from './RecordsRecentTimeline';
import { linkRecentRefresh, type RecentPageRefresh } from './recentPageRefresh';

export async function isProtectedDataReadable(
  protection: ConversationExecutionAdapter,
) {
  try {
    return (await protection.protectedDataAvailable()) === true;
  } catch {
    return false;
  }
}

export type RecentPageRow = {
  readonly key: string;
  readonly createdAt: string;
};

export type RecentPageWitness = {
  // The source's unchanging revision and protected-owner lease, not just the route.
  readonly isCurrent: () => boolean;
  readonly verify: () => Promise<boolean>;
  readonly dispose?: () => void;
};

type WitnessedRecentPage<Row> =
  | {
      readonly kind: 'pending';
      readonly witness: RecentPageWitness;
      readonly advance: () => Promise<WitnessedRecentPage<Row>>;
    }
  | {
      readonly kind: 'complete';
      readonly witness: RecentPageWitness;
      readonly rows: readonly Row[];
      readonly more: boolean;
    };

export type RecentPage<Row> = readonly Row[] | WitnessedRecentPage<Row>;

function isWitnessedPage<Row>(
  page: RecentPage<Row>,
): page is WitnessedRecentPage<Row> {
  return 'witness' in page;
}

type Ref<T> = { current: T };
type RecentPageError = 'failed' | 'refused';
export type RecentPageState = 'idle' | 'loading' | 'ready' | RecentPageError;
export type LoadRecentPage<Row> = ((
  before?: RecentPageRow,
  options?: {
    signal: AbortSignal;
    canRetry: () => Promise<boolean>;
    isCurrent: () => boolean;
  },
) => Promise<RecentPage<Row>>) & { readonly sourceIsCurrent?: () => boolean };

export async function requestRecentSavedMaterialPage<Row extends RecentPageRow>(
  ports: {
    readonly captureCurrent: () => () => boolean;
    readonly canAccess: () => boolean;
    readonly requireBridge: boolean;
    readonly load: LoadRecentPage<Row>;
    readonly refuse: () => void;
    readonly forgetWitnesses: () => void;
    readonly pending: Ref<AbortController | null>;
    readonly generation: Ref<number>;
    readonly witnesses: Ref<Map<Row, RecentPageWitness>>;
    readonly published: Ref<readonly Row[]>;
    readonly setRows: Dispatch<SetStateAction<readonly Row[]>>;
    readonly setMore: Dispatch<SetStateAction<boolean>>;
    readonly setState: Dispatch<SetStateAction<RecentPageState>>;
  },
  before?: Row,
  epoch?: RecentPageRefresh,
) {
  const {
    captureCurrent,
    canAccess,
    requireBridge,
    load,
    refuse,
    forgetWitnesses,
    pending,
    generation,
    witnesses,
    published,
    setRows,
    setMore,
    setState,
  } = ports;
  const inTab = captureCurrent();
  // A native owner can retire before React publishes the replacement loader.
  // Its old operation may not publish or turn that gap into a Retry alert.
  const ownsRead = () =>
    inTab() && canAccess() && (load.sourceIsCurrent?.() ?? true);
  if (!ownsRead() || pending.current) return false;
  const operation = new AbortController();
  pending.current = operation;
  const current = () => ownsRead() && !operation.signal.aborted;
  const protection = conversationExecutionNative();
  let retained = false;
  let publishedWitness = false;
  let witness: RecentPageWitness | undefined;
  const release = () => {
    unlink?.();
    if (!publishedWitness) witness?.dispose?.();
    if (pending.current !== operation) return;
    pending.current = null;
    if (epoch)
      setState(previous => (previous === 'loading' ? 'ready' : previous));
  };
  const unlink = epoch && linkRecentRefresh(epoch, operation, release);
  const verify = async () => {
    if (!current() || !protection?.bridgeAvailable) return false;
    const admitted = await isProtectedDataReadable(protection);
    if (!current()) return false;
    if (!admitted) refuse();
    return admitted;
  };
  try {
    setState('loading');
    if (!protection?.bridgeAvailable) {
      if (requireBridge || epoch) refuse();
      else {
        setMore(false);
        setState('ready');
      }
      return false;
    }
    if (!(await verify()) || !current()) return false;
    const read = () =>
      load(before && { createdAt: before.createdAt, key: before.key }, {
        signal: operation.signal,
        canRetry: verify,
        isCurrent: current,
      });
    const response = await read().catch(async error => {
      // Do not retain the expired snapshot or retry schema/permission errors.
      // The current protection and route must admit a fresh first page.
      if (before || !(error instanceof BoundReadRevisionChanged)) throw error;
      if (!(await verify()) || !current()) throw error;
      return read();
    });
    let rows: readonly Row[];
    let hasMore: boolean;
    const verifyPage = async () => {
      if (!(await verify())) return false;
      if (!witness) return current();
      let valid = false;
      try {
        valid = witness.isCurrent() && (await witness.verify());
      } catch {
        // Failed database reproof is not authority to keep a protected page.
      }
      if (!current()) return false;
      if (!valid || !witness.isCurrent()) {
        refuse();
        return false;
      }
      return true;
    };
    const pageIsCurrent = () => current() && (witness?.isCurrent() ?? true);
    if (isWitnessedPage(response)) {
      witness = response.witness;
      let step = response;
      while (step.kind === 'pending') {
        // Keep the previous public page and native owner while a raw cursor
        // advances. Yield between bursts without staging a short page.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (!(await verifyPage()) || !pageIsCurrent()) return false;
        const next = await step.advance();
        if (!current()) return false;
        if (next.witness !== witness) {
          refuse();
          return false;
        }
        step = next;
      }
      rows = step.rows;
      hasMore = step.more;
    } else {
      rows = response;
      hasMore = response.length === recentPageSize;
    }
    if (!(await verifyPage()) || !pageIsCurrent()) return false;
    const publish = () => {
      // A selection queued on a replaced prefix cannot open after publication.
      if (epoch) generation.current += 1;
      if (!before) forgetWitnesses();
      if (witness && rows.length) {
        for (const row of rows) witnesses.current.set(row, witness);
        publishedWitness = true;
      }
      published.current = before ? [...published.current, ...rows] : rows;
      setRows(published.current);
      setMore(hasMore);
      setState('ready');
    };
    if (epoch) {
      // Hold the exact cursor operation until every required stream can publish together.
      epoch.stage({
        isCurrent: pageIsCurrent,
        verify: verifyPage,
        publish,
        release,
      });
      retained = true;
    } else publish();
    return true;
  } catch {
    // Only a failure under current native admission can leave another
    // independently verified stream visible. Lock or bridge denial fails closed.
    if ((await verify()) && current()) {
      setState('failed');
      epoch?.fail();
    }
    return false;
  } finally {
    if (!retained) release();
  }
}
