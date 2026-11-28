import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { conversationExecutionNative } from './conversationExecutionNative';
import { watchSavedReportNativeProtection } from '../generatedReports/savedReportNativeProtection';
import { subscribeConversationVisibility } from '../storage/conversationVisibilityEvents';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import type { ConversationSessions } from './conversationSessions';
import type { DisplayMessage } from './conversationDisplayMessage';
import type { ReportBookmarkVisibility } from './reportBookmarkOwnership';

type Lease = Readonly<{ id: string; version: number }>;
type Row = Readonly<{
  question: string;
  answer: string;
  initialResponse?: DisplayMessage['initialResponse'];
}>;
export type ReadPreviousConversationDisplay = (
  lease: Lease,
  signal: AbortSignal,
) => Promise<
  | Readonly<{
      rows: readonly Row[];
      current: () => boolean;
      watch: (
        retire: () => void,
      ) => { current: () => boolean; stop: () => void } | undefined;
    }>
  | undefined
>;

export type PreviousDisplayOwner = Readonly<{
  route?: ReportBookmarkVisibility;
  store: Pick<
    ConversationSessions,
    'savedReportLease' | 'getSnapshot' | 'readPreviousDisplay'
  >;
}>;
const empty: readonly DisplayMessage[] = [];

/** A view-local read under the actual active root. Never insert this display
 * lane in ConversationSessions' history/actions or in current model context. */
export function usePreviousConversationDisplay(
  sessionId: number | undefined,
  owner: PreviousDisplayOwner | undefined,
  displayAdmitted: boolean,
) {
  const { store, route } = owner ?? {};
  const lease =
    sessionId === undefined || !route
      ? undefined
      : store?.savedReportLease(sessionId);
  const id = lease?.id;
  const version = lease?.version;
  const read = store?.readPreviousDisplay;
  const enabled = Boolean(
    displayAdmitted && route?.route?.isCurrent() && route(),
  );
  const [view, setView] = useState<{
    current: () => boolean;
    messages: readonly DisplayMessage[];
  }>();
  useEffect(() => {
    if (
      !enabled ||
      !store ||
      !read ||
      !id ||
      version === undefined ||
      !route ||
      sessionId === undefined
    )
      return;
    let alive = true;
    let flight: AbortController | undefined;
    let stopWatch: (() => void) | undefined;
    const owns = () => {
      const now = store.savedReportLease(sessionId);
      return (
        alive &&
        route.route?.isCurrent() === true &&
        route() &&
        store.getSnapshot().activeId === sessionId &&
        now?.id === id &&
        now.version === version
      );
    };
    const retire = () => {
      stopWatch?.();
      stopWatch = undefined;
      flight?.abort();
      flight = undefined;
      setView(undefined);
    };
    const load = () => {
      retire();
      if (!owns()) return;
      const controller = new AbortController();
      flight = controller;
      const native = watchSavedReportNativeProtection(
        controller.signal,
        retire,
      );
      if (!native) return;
      const current = () => flight === controller && owns() && native.current();
      const loadBound = async () => {
        if (!current() || !(await native.confirm()) || !current()) return;
        const readback = await read({ id, version }, controller.signal);
        if (
          !readback ||
          !current() ||
          !(await native.confirm()) ||
          !current() ||
          !readback.current()
        )
          return;
        // Use a disjoint display ID range. Omit durable message IDs so a scroll
        // anchor, menu or source lookup cannot write against the active owner.
        const messages = readback.rows.flatMap<DisplayMessage>((row, index) => {
          const base = Number.MIN_SAFE_INTEGER + index * 2;
          const shared = {
            restoredHistory: true,
            previousDisplayOnly: true,
          } as const;
          return [
            { ...shared, role: 'user', content: row.question, id: base },
            {
              ...shared,
              role: 'assistant',
              content: row.answer,
              initialResponse: row.initialResponse,
              id: base + 1,
            },
          ];
        });
        const witness = readback.watch(retire);
        if (!witness) return;
        stopWatch = witness.stop;
        if (current() && witness.current())
          setView({ current: () => current() && witness.current(), messages });
      };
      loadBound()
        .catch(() => undefined)
        .finally(() => {
          if (flight === controller && !stopWatch) retire();
        });
    };
    const reconcile = () => {
      if (owns()) load();
      else retire();
    };
    let routeOwned = owns();
    const routeChanged = () => {
      const next = owns();
      if (next === routeOwned) return;
      routeOwned = next;
      reconcile();
    };
    const stopRoute = route.route?.subscribe(routeChanged);
    const stopRoot = route.subscribeRoot?.(routeChanged);
    // A committed unrelated change may wake a guarded reproof, but cannot
    // remove a proven older page just because the current turn wrote.
    const rediscover = () => {
      if (!stopWatch && !flight && owns()) load();
    };
    const visibility = subscribeConversationVisibility(rediscover);
    const deletion = subscribeLocalSourceDeletion(rediscover);
    const clear = subscribeLocalDataClear(retire);
    const foreground = AppState.addEventListener('change', phase => {
      if (phase === 'active') rediscover();
      else retire();
    });
    // Native unlock and JavaScript foreground are independent observations.
    // Stay subscribed while the route owns the display, not just while a read is live.
    let stopNative: (() => void) | undefined;
    try {
      stopNative = conversationExecutionNative()?.subscribe(event => {
        if (
          event.kind === 'foreground' ||
          (event.kind === 'protectedData' && event.available)
        )
          queueMicrotask(rediscover);
      });
    } catch {
      // A failed recovery subscription never supplies a native display witness.
    }
    load();
    return () => {
      alive = false;
      stopWatch?.();
      flight?.abort();
      stopRoute?.();
      stopRoot?.();
      stopNative?.();
      visibility();
      deletion();
      clear();
      foreground.remove();
    };
  }, [enabled, id, read, route, sessionId, store, version]);
  return enabled && view?.current() ? view.messages : empty;
}
