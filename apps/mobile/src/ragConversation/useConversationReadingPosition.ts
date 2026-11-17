import { saveConversationReadingPosition } from './saveConversationReadingPosition';
import {
  useEffect,
  useReducer,
  useRef,
  type ComponentRef,
  type RefObject,
} from 'react';
import { AppState, type ScrollView } from 'react-native';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import { openConversationReadingPosition } from './openConversationReadingPosition';
import { conversationReadingKey } from './conversationReadingAnchor';
import type { DisplayMessage } from './conversationDisplayMessage';

import type { Owner } from './conversationReadingPositionTypes';
/** Restore only local reading intent. Layout and restoration never dispatch or manufacture chat turns. */
export function useConversationReadingPosition(input: {
  sessionId?: string | null;
  messages: readonly DisplayMessage[];
  blocked?: boolean;
  hasMore?: boolean;
  loading?: boolean;
  failed?: boolean;
  focused?: boolean;
  history: RefObject<ComponentRef<typeof ScrollView> | null>;
  followsBottom: RefObject<boolean>;
  expectedOffset: RefObject<number | null>;
  geometry: RefObject<{ offset: number } | null>;
}) {
  const [, render] = useReducer(n => n + 1, 0);
  const owner = useRef<Owner | null>(null);
  if (
    owner.current?.id !== input.sessionId ||
    !owner.current ||
    !owner.current.alive
  ) {
    const previous = owner.current;
    const invalidated = Boolean(previous && !previous.alive);
    // Revoking a storage lease does not remount unchanged native rows. Reuse geometry only within this same session.
    const geometry =
      invalidated && previous?.id === input.sessionId ? previous : undefined;
    if (owner.current) owner.current.alive = false;
    owner.current = {
      id: input.sessionId,
      alive: true,
      cancelled: invalidated,
      reading: false,
      ready: !input.sessionId,
      rows: geometry?.rows ?? new Map(),
      origin: geometry?.origin ?? null,
      writing: false,
    };
  }
  const state = owner.current;
  const latest = useRef(input);
  latest.current = input;
  const current = () =>
    owner.current === state &&
    state.alive &&
    AppState.currentState === 'active' &&
    !latest.current.blocked;
  const cancel = () => {
    state.cancelled = true;
    state.target = undefined;
    render();
  };
  const lastUser = input.messages.filter(m => m.role === 'user').at(-1)?.id;
  if (
    state.lastUser !== undefined &&
    lastUser !== state.lastUser &&
    lastUser !== undefined &&
    lastUser > 0
  ) {
    state.cancelled = true;
    state.saveBottom = true;
  }
  state.lastUser = lastUser;
  if (input.focused || input.failed || input.blocked || state.cancelled) {
    state.target = undefined;
    if (input.focused || input.failed) state.cancelled = true;
  }
  useEffect(() => {
    const stop = () => {
      state.alive = false;
      state.target = undefined;
      state.write = undefined;
      render();
    };
    const clear = subscribeLocalDataClear(stop);
    const deleted = subscribeLocalSourceDeletion(stop);
    const subscription = AppState.addEventListener('change', next => {
      if (next !== 'active') {
        state.cancelled = true;
        state.target = undefined;
        render();
      } else render();
    });
    return () => {
      state.alive = false;
      clear();
      deleted();
      subscription.remove();
    };
    // Each durable session owns its own protected read and queued writes.
  }, [state]);
  useEffect(() => {
    if (
      !state.id ||
      state.reading ||
      state.ready ||
      input.blocked ||
      !current()
    )
      return;
    state.reading = true;
    (async () => {
      try {
        const storage = await openConversationReadingPosition();
        if (!current()) return;
        const saved = await storage.read(state.id!, current);
        if (!current()) return;
        state.storage = storage;
        if (saved) {
          state.version = saved.version;
          if (!state.cancelled && !latest.current.focused) {
            state.target = saved.position?.bottom
              ? undefined
              : (saved.position ?? undefined);
            input.followsBottom.current = saved.position?.bottom ?? true;
          }
        }
      } catch {
        /* Protected storage failure must not hide already validated chat or start work. */
      } finally {
        state.reading = false;
        if (current()) {
          state.ready = true;
          render();
        }
      }
    })();
  });
  useEffect(() => {
    if (
      state.target &&
      state.ready &&
      !input.hasMore &&
      !input.loading &&
      !input.blocked &&
      !input.messages.some(
        m => (m.toolMessageId ?? m.retainedTurnId) === state.target?.turnId,
      )
    ) {
      state.target = undefined;
      input.followsBottom.current = true;
      render();
    }
  });
  useEffect(() => {
    if (state.saveBottom && state.ready) {
      state.saveBottom = false;
      saveConversationReadingPosition(state, input, current, { bottom: true });
    }
  });
  const reveal = () => {
    const target = state.target;
    if (
      !current() ||
      !state.ready ||
      !target ||
      state.origin === null ||
      target.bottom ||
      input.focused ||
      input.blocked
    )
      return;
    const index = input.messages.findIndex((_, i) => {
      const key = conversationReadingKey(input.messages, i);
      return key?.turnId === target.turnId && key.role === target.role;
    });
    const row = input.messages[index];
    const top = row && state.rows.get(row.id);
    if (top === undefined) return;
    const y = Math.max(
      0,
      state.origin +
        top.y +
        Math.min(target.offset, Math.max(0, top.height - 1)),
    );
    state.target = undefined;
    input.followsBottom.current = false;
    input.expectedOffset.current = y;
    input.history.current?.scrollTo({ y, animated: false });
    render();
  };
  useEffect(reveal);

  return {
    pending: Boolean(
      state.id &&
      !state.cancelled &&
      (!state.ready || (state.target && !state.target.bottom)),
    ),
    targetId: state.cancelled ? undefined : state.target?.turnId,
    cancel,
    save: (override?: { offset?: number; bottom?: boolean }) =>
      saveConversationReadingPosition(state, input, current, override),
    container(y: number) {
      if (Number.isFinite(y)) {
        state.origin = y;
        reveal();
      }
    },
    row(id: number, y: number, height: number) {
      if (Number.isFinite(y) && Number.isFinite(height) && height > 0) {
        state.rows.set(id, { y, height });
        reveal();
      }
    },
  };
}
