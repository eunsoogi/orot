import { visibleSavedHistoryDisplay } from './conversationSavedHistoryDisplay';
import { createConversationA2UIModalArbiter } from './conversationA2UIModalArbiter';
import {
  captureReportBookmarkOwner,
  type ReportBookmarkVisibility,
} from './reportBookmarkOwnership';
import {
  createContext,
  useCallback,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { AppState } from 'react-native';
import type { ConversationA2UINode } from './conversationA2UI';
import type { ConversationSessions } from './conversationSessions';

interface Owner {
  readonly surface: (root: ConversationA2UINode) => string | undefined;
  readonly subscribe: (listener: () => void) => () => void;
  readonly hasArchive?: (
    root: ConversationA2UINode,
    lease: { id: string; version: number },
  ) => boolean;
  readonly beginArchive?: (
    root: ConversationA2UINode,
    lease: { id: string; version: number },
    mounted: () => boolean,
    onLost: () => void,
  ) =>
    | { controller: AbortController; current: () => boolean; close: () => void }
    | undefined;
}

export const ConversationA2UILocalDraftOwner = createContext<Owner | undefined>(
  undefined,
);

/** Resolve the stamp from live owning session state, not a render snapshot
 * and never the model's fixed draft stamp. Closing/replacing a session or
 * starting another request must invalidate already queued native callbacks. */
export function useConversationA2UILocalDraftOwner(
  store: ConversationSessions,
  sessionId: number,
  [ownsPresentation, archiveVisibility]: readonly [
    (() => boolean) | undefined,
    ReportBookmarkVisibility | undefined,
  ],
) {
  return useMemo<Owner>(() => {
    const sheets = createConversationA2UIModalArbiter();
    const hasArchive: NonNullable<Owner['hasArchive']> = (root, lease) => {
      const active = store.savedReportLease(sessionId);
      const session = store
        .getSnapshot()
        .sessions.find(item => item.id === sessionId);
      return (
        active?.id === lease.id &&
        active.version === lease.version &&
        ownsPresentation?.() === true &&
        archiveVisibility?.() === true &&
        archiveVisibility.route?.isCurrent() === true &&
        !!session &&
        !session.busy &&
        !session.preparingSend &&
        !!visibleSavedHistoryDisplay(session)?.some(
          ({ row }) =>
            row.kind === 'answer' && row.archivedA2UIPresentation === root,
        )
      );
    };
    return {
      hasArchive,
      beginArchive(root, lease, mounted, onLost) {
        const current = () => hasArchive(root, lease);
        if (!current()) return;
        const controller = sheets.acquire();
        if (!controller) return;
        const owner = captureReportBookmarkOwner({
          store,
          sessionId,
          current: Object.assign(current, {
            route: archiveVisibility?.route,
            subscribeRoot: archiveVisibility?.subscribeRoot,
          }),
          mounted,
          allowDraftChanges: true,
          onLost: () => {
            sheets.release(controller);
            onLost();
          },
        });
        const close = () => {
          sheets.release(controller);
          owner.close();
        };
        const valid = () =>
          sheets.owns(controller) && current() && owner.current();
        if (!valid()) {
          close();
          return;
        }
        return { controller, close, current: valid };
      },
      surface(root) {
        if (
          AppState.currentState !== 'active' ||
          ownsPresentation?.() === false ||
          !store.ownsActiveSession(sessionId)
        )
          return undefined;
        const session = store
          .getSnapshot()
          .sessions.find(item => item.id === sessionId);
        if (
          !session ||
          session.quarantined ||
          session.restoring ||
          session.busy ||
          session.pendingMessage ||
          session.leaseRefreshRequired
        )
          return undefined;
        const last = session.messages.at(-1);
        if (last?.role !== 'assistant' || last.a2uiPresentation !== root)
          return undefined;
        return `orot:${sessionId}:${last.id}`;
      },
      subscribe(listener) {
        const stop = store.subscribe(listener);
        const appState = AppState.addEventListener('change', listener);
        return () => {
          stop();
          appState.remove();
        };
      },
    };
  }, [archiveVisibility, ownsPresentation, sessionId, store]);
}

const subscribeIdle = () => () => {};

/** The answer may publish before the turn clears busy. This primitive selector
 * observes admission even when the answer body and owner context are memoized. */
export function useOwnedConversationA2UIStamp(
  owner: Owner | undefined,
  root: ConversationA2UINode | undefined,
  enabled: boolean,
) {
  const read = useCallback(
    () => (enabled && root ? owner?.surface(root) : undefined),
    [enabled, owner, root],
  );
  return useSyncExternalStore(
    enabled && owner ? owner.subscribe : subscribeIdle,
    read,
  );
}
