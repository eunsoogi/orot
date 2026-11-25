import { useRef } from 'react';
import { useNavigationRouteRefresh } from '../navigation/navigationRouteRefresh';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import type { GeneratedReportDetailPresentationState } from './GeneratedReportDetailPresentation';
import type { GeneratedReportCitationSelection } from './types';

export type RefreshSelection = {
  readonly prior?: GeneratedReportCitationSelection['target'];
  readonly keepVisible: boolean;
  readonly verify: () => Promise<boolean>;
  readonly claim: (controller: AbortController) => void;
};

type ReportTarget = GeneratedReportCitationSelection['target'];

/** A reread must not replace a retained report with a different leased artifact. */
export function isSameRefreshedReport(
  prior: ReportTarget,
  next: ReportTarget | undefined,
) {
  return (
    next?.sessionId === prior.sessionId &&
    next.sessionVersion === prior.sessionVersion &&
    next.turnId === prior.turnId &&
    next.createdAt === prior.createdAt &&
    next.summary?.id === prior.summary?.id &&
    next.summary?.revision === prior.summary?.revision
  );
}

interface RefreshOwner {
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
  readonly invalidate: () => void;
  readonly read: (verify: () => Promise<boolean>) => Promise<void>;
}

/** A warm local database handle does not prove protected data is currently readable. */
async function refreshOwnedGeneratedReport({
  signal,
  isCurrent,
  invalidate,
  read,
}: RefreshOwner) {
  const native = conversationExecutionNative();
  if (!native?.bridgeAvailable || signal.aborted || !isCurrent()) return;
  let retired = false;
  const retire = () => {
    if (retired) return;
    retired = true;
    if (isCurrent()) invalidate();
  };
  const remove = native.subscribe(event => {
    if (event.kind === 'protectedData' && event.available !== true) retire();
  });
  const verify = async () => {
    if (retired || signal.aborted || !isCurrent()) return false;
    let available: boolean | null = null;
    try {
      available = await native.protectedDataAvailable();
    } catch {
      // An unknown native witness is not access, even if JS still appears active.
    }
    if (retired || signal.aborted || !isCurrent()) return false;
    if (available !== true) retire();
    return available === true && !retired && isCurrent();
  };
  const stopped = new Promise<false>(resolve => {
    if (signal.aborted) resolve(false);
    else signal.addEventListener('abort', () => resolve(false), { once: true });
  });
  try {
    if ((await Promise.race([verify(), stopped])) && isCurrent())
      await Promise.race([read(verify), stopped]);
  } finally {
    retired = true;
    remove();
  }
}

interface DetailRefresh {
  readonly active: boolean;
  readonly state: GeneratedReportDetailPresentationState;
  readonly request: { readonly current: AbortController | null };
  readonly canAccess: () => boolean;
  readonly invalidate: () => void;
  readonly read: (refresh: RefreshSelection) => Promise<void>;
  readonly hasSourceTrip: () => boolean;
}

/** Refresh the selected row only, never rearm a durably unavailable report or a citation trip. */
export function useGeneratedReportPull({
  active,
  state,
  request,
  canAccess,
  invalidate,
  read,
  hasSourceTrip,
}: DetailRefresh) {
  const refreshing = useRef(false);
  useNavigationRouteRefresh(
    active && state.status !== 'unavailable',
    async acceptGesture => {
      let owner = request.current;
      if (
        !owner ||
        owner.signal.aborted ||
        refreshing.current ||
        hasSourceTrip() ||
        state.status === 'unavailable'
      )
        return;
      const isCurrent = () =>
        owner !== null &&
        request.current === owner &&
        !owner.signal.aborted &&
        canAccess();
      if (!isCurrent()) return;
      const gesture = new AbortController();
      const stop = () => gesture.abort();
      function claim(controller: AbortController) {
        owner?.signal.removeEventListener('abort', stop);
        owner = controller;
        owner.signal.addEventListener('abort', stop, { once: true });
      }
      claim(owner);
      refreshing.current = true;
      const prior =
        state.status === 'ready'
          ? state.detail.conversationSources?.target
          : undefined;
      try {
        await refreshOwnedGeneratedReport({
          signal: gesture.signal,
          isCurrent,
          invalidate,
          read: verify => {
            acceptGesture();
            return read({
              prior,
              keepVisible: state.status === 'ready',
              verify,
              claim,
            });
          },
        });
      } finally {
        owner?.signal.removeEventListener('abort', stop);
        gesture.abort();
        refreshing.current = false;
      }
    },
  );
  return refreshing;
}
