import { AppState } from 'react-native';
import type { ConversationSessions } from './conversationSessions';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import type { SubscribeRootConversationVisibility } from './ConversationSessionsContext';

export type ReportBookmarkVisibility = (() => boolean) &
  Partial<{
    readonly route: NavigationRouteOwnership;
    readonly subscribeRoot: SubscribeRootConversationVisibility;
  }>;

/** The positive owner snapshot never becomes valid again after leaving its
 * scope. A matching restored draft or selected session cannot revive it. */
export function captureReportBookmarkOwner(input: {
  readonly store: ConversationSessions;
  readonly sessionId: number;
  readonly current?: ReportBookmarkVisibility;
  readonly mounted?: () => boolean;
  readonly allowDraftChanges?: boolean;
  readonly allowOwnSend?: boolean;
  readonly onLost?: () => void;
}) {
  const { store, sessionId, current } = input;
  const route = current?.route;
  const original = store
    .getSnapshot()
    .sessions.find(row => row.id === sessionId);
  const captured = store.savedReportLease(sessionId);
  let invalidated = false;
  const cleanups: Array<() => void> = [];
  const stillCurrent = () => {
    const { activeId, sessions } = store.getSnapshot();
    const session = sessions.find(row => row.id === sessionId);
    const now = store.savedReportLease(sessionId);
    return Boolean(
      original &&
      captured &&
      session &&
      activeId === sessionId &&
      (input.allowDraftChanges ||
        session.draftEditRevision === original.draftEditRevision) &&
      (input.allowDraftChanges ||
        input.allowOwnSend ||
        session.draft === original.draft) &&
      now?.id === captured.id &&
      now.version === captured.version &&
      !session.quarantined &&
      !session.restoring &&
      // Own preflight may suspend selection while preserving this exact admitted
      // display lease. A withheld display still retires it permanently.
      (!session.modelSelectionPending ||
        (input.allowOwnSend &&
          session.preparingSend &&
          session.modelSelectionKeepsDisplay)) &&
      !session.modelSelectionFailed &&
      !session.leaseRefreshRequired &&
      (input.allowDraftChanges ||
        input.allowOwnSend ||
        (!session.busy && !session.preparingSend)) &&
      (input.mounted?.() ?? true) &&
      AppState.currentState === 'active' &&
      (route?.isCurrent() ?? true) &&
      (current?.() ?? true),
    );
  };
  const close = () => {
    invalidated = true;
    for (const cleanup of cleanups.splice(0)) cleanup();
  };
  const revoke = () => {
    if (invalidated) return;
    close();
    input.onLost?.();
  };
  const check = () => {
    if (!invalidated && !stillCurrent()) revoke();
    return !invalidated;
  };
  const track = (unsubscribe: (() => void) | undefined) => {
    if (!unsubscribe) return;
    if (invalidated) unsubscribe();
    else cleanups.push(unsubscribe);
  };
  if (!check()) return { current: check, close };
  track(store.subscribe(check));
  track(route?.subscribe(check));
  track(
    current?.subscribeRoot?.(visible => {
      if (!visible) revoke();
    }),
  );
  const appState = AppState.addEventListener('change', state => {
    if (state !== 'active') revoke();
  });
  track(() => appState.remove());
  return { current: check, close };
}
