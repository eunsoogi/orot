import { createRecentPublicationStage } from './recentPublicationStage';
import {
  reportRecentReadStage,
  reportRecentReadCompletion,
  observeRecentReadStage,
  enterRecentReadGate,
} from './recentSavedMaterialReadDiagnostics';
import {
  isWitnessedPage,
  type LoadRecentPage,
  type RecentPageRow,
  type RecentPageState,
  type RecentPageWitness,
  type SettledRecentReceipt,
  type Ref,
} from './recentSavedMaterialPageTypes';
export type {
  LoadRecentPage,
  RecentPage,
  RecentPageRow,
  RecentPageState,
  RecentPageWitness,
} from './recentSavedMaterialPageTypes';
import type { Dispatch, SetStateAction } from 'react';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import { isProtectedDataReadable } from './recentDataProtection';
export { isProtectedDataReadable } from './recentDataProtection';
import { BoundReadRevisionChanged } from '../storage/boundReadResultWitness';
import { recentPageSize } from './RecordsRecentTimeline';
import { linkRecentRefresh, type RecentPageRefresh } from './recentPageRefresh';

// A warm return can race more than one short, unrelated committed write.
const maxFirstPageRevisionRestarts = 2;

export async function requestRecentSavedMaterialPage<Row extends RecentPageRow>(
  ports: {
    readonly publishSettled?: (receipt?: SettledRecentReceipt) => void;
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
    publishSettled,
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
  if (!enterRecentReadGate(inTab, canAccess, load, pending)) return false;
  const operation = new AbortController();
  pending.current = operation;
  const current = () => ownsRead() && !operation.signal.aborted;
  const protection = conversationExecutionNative();
  let retained = false;
  let publishedWitness = false;
  let witness: RecentPageWitness | undefined;
  const settlement = createRecentPublicationStage(
    !before && !epoch,
    inTab,
    publishSettled,
  );
  const release = () => {
    unlink?.();
    settlement.reset();
    if (!publishedWitness) witness?.dispose?.();
    if (pending.current !== operation) return;
    pending.current = null;
    if (epoch)
      setState(previous => (previous === 'loading' ? 'ready' : previous));
  };
  const unlink = epoch && linkRecentRefresh(epoch, operation, release);
  const verify = async () => {
    if (!current() || !protection?.bridgeAvailable) return false;
    reportRecentReadStage('recent_records_admission', 'started');
    const admitted = await isProtectedDataReadable(protection);
    reportRecentReadCompletion('recent_records_admission', current, admitted);
    if (!current()) return false;
    if (!admitted) refuse();
    return admitted;
  };
  try {
    setState('loading');
    if (!protection?.bridgeAvailable) {
      reportRecentReadStage('recent_records_admission', 'failed');
      if (requireBridge || epoch) refuse();
      else {
        setMore(false);
        setState('ready');
      }
      return false;
    }
    if (!(await verify()) || !current()) return false;
    const read = () =>
      observeRecentReadStage('recent_records_source_read', current, () =>
        load(before && { createdAt: before.createdAt, key: before.key }, {
          signal: operation.signal,
          canRetry: verify,
          isCurrent: current,
          ...settlement.options,
        }),
      );
    const checkWitness = async (restart?: true) => {
      if (!(await verify())) return false;
      if (!witness) return current();
      let valid = false;
      try {
        valid = restart
          ? await witness.verify(true)
          : witness.isCurrent() && (await witness.verify());
        if (restart && current()) witness.requireCurrent?.();
      } catch (error) {
        if (restart && error instanceof BoundReadRevisionChanged) throw error;
        // Failed database reproof is not authority to keep a protected page.
      }
      if (!current()) return false;
      if (!valid || !witness.isCurrent()) {
        refuse();
        return false;
      }
      return true;
    };
    const checkPage = (restart?: true) =>
      observeRecentReadStage('recent_records_reproof', current, () =>
        checkWitness(restart),
      );
    const pageIsCurrent = () => current() && (witness?.isCurrent() ?? true);
    const candidate = async () => {
      const response = await read();
      const restart = !before && !epoch ? true : undefined;
      let rows: readonly Row[];
      let more: boolean;
      if (isWitnessedPage(response)) {
        witness = response.witness;
        let step = response;
        while (step.kind === 'pending') {
          // Advance only the still-private cursor. Visible rows are not staged.
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          if (!(await checkPage(restart)) || !pageIsCurrent()) return null;
          const next = await step.advance();
          if (!current()) return null;
          if (next.witness !== witness) {
            refuse();
            return null;
          }
          step = next;
        }
        settlement.capture(step.settle);
        rows = step.rows;
        more = step.more;
      } else {
        rows = response;
        more = response.length === recentPageSize;
      }
      return (await checkPage(restart)) && pageIsCurrent()
        ? { rows, more }
        : null;
    };
    let restarts = 0;
    const readWithRevisionRecovery = async (): ReturnType<typeof candidate> => {
      try {
        return await candidate();
      } catch (error) {
        // Only a first page can restart from scratch after a transient revision.
        // No stale cursor, broader authority, or retry of a real SQL failure.
        if (
          before ||
          !(error instanceof BoundReadRevisionChanged) ||
          restarts >= maxFirstPageRevisionRestarts
        )
          throw error;
        restarts++;
        witness?.dispose?.();
        witness = undefined;
        settlement.reset();
        if (!(await verify()) || !current()) throw error;
        return readWithRevisionRecovery();
      }
    };
    const result = await readWithRevisionRecovery();
    if (!result || !current()) return false;
    if (!pageIsCurrent()) {
      refuse();
      return false;
    }
    const { rows, more: hasMore } = result;
    const publish = () => {
      // A selection queued on a replaced prefix cannot open after publication.
      if (epoch) generation.current += 1;
      if (!before) forgetWitnesses();
      if (witness && rows.length) {
        for (const row of rows) witnesses.current.set(row, witness);
        publishedWitness = true;
      }
      settlement.publish();
      published.current = before ? [...published.current, ...rows] : rows;
      setRows(published.current);
      setMore(hasMore);
      setState('ready');
    };
    if (epoch) {
      // Hold the exact cursor operation until every required stream can publish together.
      epoch.stage({
        isCurrent: pageIsCurrent,
        verify: checkPage,
        publish,
        release,
      });
      retained = true;
    } else publish();
    return true;
  } catch (error) {
    // Only a failure under current native admission can leave another
    // independently verified stream visible. Lock or bridge denial fails closed.
    if ((await verify()) && current()) {
      if (witness && error instanceof BoundReadRevisionChanged) refuse();
      else setState('failed');
      epoch?.fail();
    }
    return false;
  } finally {
    if (!retained) release();
  }
}
