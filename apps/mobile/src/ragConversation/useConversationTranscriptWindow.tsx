import { useConversationHistoryTarget } from './useConversationHistoryTarget';
import { useReducer, useRef, type ComponentRef, type RefObject } from 'react';
import type { ScrollView } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { t } from '../i18n';
import type { DisplayMessage } from './ConversationMessage';

const pageSize = 20;
/** Keep paired authored input with its answer when the display window cuts across a turn. */
export function transcriptWindowStart(
  messages: readonly DisplayMessage[],
  end: number,
) {
  let start = Math.max(0, end - pageSize);
  if (
    start > 0 &&
    messages[start]?.role === 'assistant' &&
    messages[start - 1]?.role === 'user'
  )
    start--;
  return start;
}
type WindowState = {
  session: number | undefined;
  firstId?: number;
  expanded: boolean;
  lastUserId?: number;
  pending?: { id: number; offset: number; settled?: boolean };
};
/** Presentation only: never trim the store, retained provenance, provider history or protected records.
 * Track an existing row's layout, not total content growth, so streaming below cannot shift a prepend anchor. */
export function useConversationTranscriptWindow(input: {
  messages: readonly DisplayMessage[];
  sessionId?: number;
  focusId?: string;
  focusGeneration?: number;
  firstRowInset?: number;
  hasMore?: boolean;
  loading?: boolean;
  failed?: boolean;
  loadOlder?: (signal?: AbortSignal) => Promise<void>;
  history: RefObject<ComponentRef<typeof ScrollView> | null>;
  followsBottom: RefObject<boolean>;
  expectedOffset: RefObject<number | null>;
  geometry: RefObject<{ offset: number } | null>;
}) {
  const [, render] = useReducer(value => value + 1, 0);
  const state = useRef<WindowState>({
    session: input.sessionId,
    expanded: false,
  });
  if (state.current.session !== input.sessionId)
    state.current = { session: input.sessionId, expanded: false };
  const current = state.current;
  const { messages } = input;
  let lastUserId: number | undefined;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === 'user') {
      lastUserId = messages[index]?.id;
      break;
    }
  }
  if (current.lastUserId !== undefined && current.lastUserId !== lastUserId)
    current.pending = undefined;
  current.lastUserId = lastUserId;
  let start =
    current.firstId === undefined
      ? -1
      : messages.findIndex(item => item.id === current.firstId);
  if (start < 0) {
    start = input.loadOlder
      ? 0
      : transcriptWindowStart(messages, messages.length);
    current.firstId = messages[start]?.id;
    current.pending = undefined;
    current.expanded = false;
  }
  if (input.loadOlder) start = 0;
  const focused = input.focusId
    ? messages.findIndex(item => item.retainedTurnId === input.focusId)
    : -1;
  useConversationHistoryTarget({ ...input, found: focused >= 0 });
  if (focused >= 0 && focused < start) {
    start = messages[focused - 1]?.role === 'user' ? focused - 1 : focused;
    current.firstId = messages[start]?.id;
    current.pending = undefined;
    current.expanded = true;
  }
  if (
    current.pending &&
    (input.focusId || !messages.some(item => item.id === current.pending?.id))
  )
    current.pending = undefined;
  if (current.pending?.settled && messages[0]?.id === current.pending.id)
    current.pending = undefined;
  const anchor = current.pending;
  // Keep the control's layout after the last page so the anchored transcript origin does not move.
  const more = input.loadOlder ? input.hasMore : start > 0;
  const showControl = more || current.expanded || input.loading || input.failed;
  const reveal = () => {
    if (state.current !== current || current.pending || input.loading || !more)
      return;
    current.pending = {
      id: messages[start]?.id ?? 0,
      offset: input.geometry.current?.offset ?? 0,
    };
    if (!input.loadOlder)
      current.firstId = messages[transcriptWindowStart(messages, start)]?.id;
    current.expanded = true;
    input.followsBottom.current = false;
    input.expectedOffset.current = null;
    render();
    if (input.loadOlder) {
      const pending = current.pending;
      input
        .loadOlder()
        .catch(() => {})
        .finally(() => {
          // A failed/exhausted read with no prepend must release the retry control.
          if (
            state.current === current &&
            current.pending === pending &&
            pending
          ) {
            pending.settled = true;
            render();
          }
        });
    }
  };
  return {
    onTopEdge(offset: number, userInitiated: boolean) {
      if (userInitiated && offset <= 64 && !input.failed) reveal();
    },
    messages: messages.slice(start),
    anchorId: current.pending?.id,
    cancelAnchor() {
      if (state.current === current && current.pending) {
        current.pending = undefined;
        render();
      }
    },
    onAnchorLayout(y: number) {
      if (state.current !== current || !anchor || current.pending !== anchor)
        return;
      // The original first row has a positive padding inset too. Its initial layout
      // is not a prepend; wait until older rows actually precede this same identity.
      if (messages[start]?.id === anchor.id || !Number.isFinite(y)) return;
      const addedHeight = y - (input.firstRowInset ?? 0);
      if (addedHeight <= 0) return;
      const offset = Math.max(0, current.pending.offset + addedHeight);
      current.pending = undefined;
      input.followsBottom.current = false;
      input.expectedOffset.current = offset;
      input.history.current?.scrollTo({ y: offset, animated: false });
      render();
    },
    control: showControl ? (
      <AppButton
        variant="text"
        title={t(
          input.loading
            ? 'ragConversation.history.loading'
            : input.failed
              ? 'ragConversation.history.retry'
              : more
                ? 'ragConversation.history.earlier'
                : 'ragConversation.history.allShown',
        )}
        testID="conversation-earlier-messages"
        disabled={!more || Boolean(current.pending) || input.loading}
        onPress={reveal}
      />
    ) : null,
  };
}
