import { t } from '../i18n';
import type { ConversationSessionOptions } from './conversationSessionTypes';
import type { ConversationHistoryCursor } from './conversationHistoryPage';

type SessionPage = Awaited<
  ReturnType<NonNullable<ConversationSessionOptions['listSessions']>>
>;
type SessionRow = SessionPage['items'][number];
export type ArchiveLine = {
  readonly key: number;
  readonly role: 'user' | 'assistant';
  readonly content: string;
};
type Snapshot = {
  readonly sessions: readonly SessionRow[];
  readonly sessionCursor: SessionPage['nextCursor'];
  readonly selected: string | null;
  readonly lines: readonly ArchiveLine[];
  readonly cursor: ConversationHistoryCursor | null;
  readonly loading: boolean;
  readonly failed: boolean;
};
const empty = (): Snapshot => ({
  sessions: [],
  sessionCursor: null,
  selected: null,
  lines: [],
  cursor: null,
  loading: false,
  failed: false,
});

/** Display-only owner: exposes no source aliases/actions and never selects model context.
 * The existing strict reader can still register its internal aliases while validating a page. */
export function createConversationArchive(options: ConversationSessionOptions) {
  let state = empty();
  let controller: AbortController | undefined;
  let epoch = 0;
  let nextLine = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  const publish = (next: Snapshot) => {
    state = next;
    listeners.forEach(listener => listener());
  };
  const invalidate = () => {
    ++epoch;
    controller?.abort();
    controller = undefined;
    publish(empty());
  };
  const run = async (
    work: (signal: AbortSignal, current: () => boolean) => Promise<void>,
  ) => {
    if (disposed || state.loading) return;
    controller?.abort();
    const signal = (controller = new AbortController()).signal;
    const generation = ++epoch;
    const current = () => !disposed && !signal.aborted && generation === epoch;
    publish({ ...state, loading: true, failed: false });
    try {
      await work(signal, current);
    } catch {
      if (current()) publish({ ...state, failed: true });
    } finally {
      if (current()) publish({ ...state, loading: false });
    }
  };
  return {
    available: Boolean(options.listSessions && options.restoreSessionPage),
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    invalidate,
    dispose() {
      invalidate();
      disposed = true;
      listeners.clear();
    },
    async list(more = false) {
      if (!options.listSessions || (more && !state.sessionCursor)) return;
      return run(async (_signal, current) => {
        const page = await options.listSessions!(
          more ? state.sessionCursor! : undefined,
        );
        if (!current()) return;
        const sessions = new Map(
          (more ? state.sessions : []).map(row => [row.id, row]),
        );
        for (const row of page.items) sessions.set(row.id, row);
        publish({
          ...state,
          sessions: [...sessions.values()],
          sessionCursor: page.nextCursor,
        });
      });
    },
    async select(id: string) {
      if (
        !options.restoreSessionPage ||
        !state.sessions.some(row => row.id === id)
      )
        return;
      // A deliberate different selection cancels outstanding reads rather than publishing the old body.
      ++epoch;
      controller?.abort();
      publish({
        ...state,
        selected: id,
        lines: [],
        cursor: null,
        loading: false,
        failed: false,
      });
      await this.loadOlder();
    },
    async loadOlder() {
      if (
        !options.restoreSessionPage ||
        !state.selected ||
        (state.lines.length > 0 && !state.cursor)
      )
        return;
      const id = state.selected;
      return run(async (signal, current) => {
        const page = await options.restoreSessionPage!(
          id,
          signal,
          state.cursor ?? undefined,
        );
        if (!current() || state.selected !== id) return;
        // Deliberately do not return RestoredTurn/DisplayMessage, whose fields confer actions and history reuse.
        const lines = page.turns.flatMap<Omit<ArchiveLine, 'key'>>(turn => [
          ...(!turn.historyUnavailable && turn.question
            ? [{ role: 'user' as const, content: turn.question }]
            : []),
          ...(turn.preview || turn.answer
            ? [
                {
                  role: 'assistant' as const,
                  content: turn.historyUnavailable
                    ? turn.answer
                    : turn.answer || turn.preview || '',
                },
              ]
            : []),
          ...(!turn.historyUnavailable &&
          (turn.interrupted || (!turn.answer && turn.completion === 'partial'))
            ? [
                {
                  role: 'assistant' as const,
                  content: t('ragConversation.archive.interrupted'),
                },
              ]
            : []),
        ]);
        publish({
          ...state,
          lines: [
            ...lines.map(line => ({ ...line, key: ++nextLine })),
            ...state.lines,
          ],
          cursor: page.nextCursor,
        });
      });
    },
  };
}

/** Existing deletion/disposal entry points invalidate the separate reader without altering dispatch policy. */
export function withConversationArchive<
  T extends {
    refreshAfterSourceDeletion: (
      ...args: import('../storage/localDataClearEvents').SourceDeletionEvent
    ) => void;
    invalidateAll(): void;
    synchronizeModel(refresh?: boolean): Promise<void>;
    dispose(): void;
  },
>(store: T, options: ConversationSessionOptions) {
  const archive = createConversationArchive(options);
  return {
    ...store,
    archive,
    refreshAfterSourceDeletion(
      ...args: import('../storage/localDataClearEvents').SourceDeletionEvent
    ) {
      archive.invalidate();
      store.refreshAfterSourceDeletion(...args);
    },
    synchronizeModel(refresh?: boolean) {
      archive.invalidate();
      return store.synchronizeModel(refresh);
    },
    invalidateAll() {
      archive.invalidate();
      store.invalidateAll();
    },
    dispose() {
      archive.dispose();
      store.dispose();
    },
  };
}
