import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, Keyboard } from 'react-native';
import type { RecentMediaRow } from '../routes/recentSourceReader';
import {
  currentRecordingProtection,
  emptyRecordingPage,
  requestRecordingPickerPage,
  type RecordingPickerRequest,
} from './conversationRecordingPickerPage';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import { conversationExecutionNative } from './conversationExecutionNative';
import { createConversationRecordingDraft } from './conversationRecordingDraft';
import { conversationComposerDisabled } from './conversationComposerDisabled';
import { entryIntentSender } from './entryIntentSender';
import { conversationEntryForSession } from './useConversationEntryIntent';
import type { ConversationScreenProps } from './ConversationScreenProps';
import type { ConversationSessions } from './conversationSessions';
import { useRootConversationVisibilitySubscription } from './ConversationSessionsContext';

type Scope = {
  store: ConversationSessions;
  id: number;
  modelRevision: number | undefined;
  routeKey: string | undefined;
  isEntryCurrent?: () => boolean;
  ordinary: boolean;
};

/** Browsing reads bounded committed metadata only. Consent for transcript use never comes from the picker. */
export function useConversationRecordingAttachment(input: Scope) {
  const { store, id, modelRevision, routeKey, ordinary } = input;
  const subscribeRoot = useRootConversationVisibilitySubscription();
  const [selected, setSelected] = useState<RecentMediaRow | null>(null);
  const [page, setPage] = useState(emptyRecordingPage);
  const [open, setOpen] = useState(false);
  const draft = useMemo(
    () => createConversationRecordingDraft<RecentMediaRow>(setSelected),
    [],
  );
  const scope = useMemo(
    () => ({ store, id, modelRevision, routeKey, ordinary }),
    [store, id, modelRevision, routeKey, ordinary],
  );
  const latest = useRef({ input, scope });
  latest.current = { input, scope };
  const mounted = useRef(false);
  const picker = useRef<RecordingPickerRequest | null>(null);

  const current = useCallback(() => {
    const state = store.getSnapshot();
    const session = state.sessions.find(item => item.id === id);
    const entry = conversationEntryForSession(store, id);
    return Boolean(
      mounted.current &&
      latest.current.scope === scope &&
      latest.current.input.ordinary &&
      modelRevision !== undefined &&
      (latest.current.input.isEntryCurrent?.() ?? true) &&
      AppState.currentState === 'active' &&
      state.activeId === id &&
      session &&
      !conversationComposerDisabled(session, store.continuous) &&
      !session.modelSelectionFailed &&
      !session.restoreFailed &&
      !session.leaseRefreshRequired &&
      !session.dailyReport &&
      !session.entryIntent &&
      (!entry || entry.intent === 'conversation') &&
      store.photoDrafts.get(id).status === 'empty',
    );
  }, [store, id, modelRevision, scope]);

  const close = useCallback(() => {
    picker.current?.controller.abort();
    picker.current = null;
    setOpen(false);
    setPage(emptyRecordingPage);
  }, []);
  const clear = useCallback(() => {
    close();
    draft.clear();
  }, [close, draft]);

  useLayoutEffect(() => {
    mounted.current = true;
    const observe = () => {
      const session = store.getSnapshot().sessions.find(item => item.id === id);
      if (!current() || (session?.busy && !draft.busy())) clear();
    };
    observe();
    const stop = store.subscribe(observe);
    const photo = store.photoDrafts.subscribe(observe);
    // The root tab can leave and return in a single React commit.
    const root = subscribeRoot?.(visible => {
      if (!visible) clear();
    });
    const data = subscribeLocalDataClear(clear);
    const deletion = subscribeLocalSourceDeletion((_origin, ids) => {
      close();
      draft.revoke(ids);
    });
    const app = AppState.addEventListener('change', state => {
      if (state !== 'active') clear();
    });
    const native = conversationExecutionNative()?.subscribe(event => {
      if (event.kind === 'protectedData' && !event.available) clear();
    });
    return () => {
      mounted.current = false;
      clear();
      stop();
      photo();
      root?.();
      data();
      deletion();
      app.remove();
      native?.();
    };
  }, [store, id, current, clear, close, draft, subscribeRoot]);

  const request = async () => {
    const owner = picker.current;
    if (owner)
      await requestRecordingPickerPage(
        owner,
        () => picker.current === owner && current(),
        setPage,
      );
  };

  return {
    enabled: input.ordinary && input.modelRevision !== undefined,
    selected: current() ? selected : null,
    open: current() && open,
    page,
    openPicker() {
      const session = store.getSnapshot().sessions.find(item => item.id === id);
      if (
        !current() ||
        session?.busy ||
        session?.preparingSend ||
        picker.current
      )
        return;
      Keyboard.dismiss();
      picker.current = {
        controller: new AbortController(),
        pending: false,
        rows: [],
      };
      setOpen(true);
      request().catch(() => {});
    },
    close,
    more: () => request().catch(() => {}),
    clear,
    async pick(row: RecentMediaRow) {
      const owner = picker.current;
      if (!owner || owner.pending || !owner.rows.includes(row) || !current())
        return;
      const allowed = await currentRecordingProtection();
      if (picker.current !== owner || !current()) return;
      if (allowed !== true) {
        clear();
        return;
      }
      if (owner.rows.includes(row) && draft.select(row)) close();
    },
    /** True means this tap belongs to the attachment, even when the stale selection is denied. */
    dispatch(onSend: ConversationScreenProps['onSend']) {
      if (!draft.get() && !draft.busy()) return false;
      if (!current() || draft.busy()) return true;
      const session = store.getSnapshot().sessions.find(item => item.id === id);
      const text = session?.draft.trim();
      if (!text || session?.busy || session?.preparingSend) return true;
      const ticket = draft.claim(current);
      if (!ticket) return true;
      const send = entryIntentSender(store, id, onSend, 'composer');
      // Do not mark this sender warm or give an attachment to an unrelated template or retry.
      store
        .send(id, async (question, history, signal, observer) => {
          const isCurrent = () => !signal?.aborted && ticket.isCurrent();
          if (!isCurrent() || question !== text)
            return { status: 'unavailable' };
          const protectedNow = await currentRecordingProtection();
          if (!isCurrent()) return { status: 'unavailable' };
          if (!protectedNow) {
            clear();
            return { status: 'unavailable' };
          }
          if (!ticket.admit()) return { status: 'unavailable' };
          return send(question, history, signal, {
            ...observer,
            selectedRecordingTranscript: {
              sourceId: ticket.sourceId,
              isCurrent,
            },
          });
        })
        .finally(ticket.release)
        .catch(() => {});
      return true;
    },
  };
}
