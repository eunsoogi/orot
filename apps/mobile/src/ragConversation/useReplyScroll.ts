import { useCallback, useEffect, useRef } from 'react';
import type { ComponentRef, RefObject } from 'react';
import { AppState } from 'react-native';
import type { ScrollView } from 'react-native';
import type { ReplyFocusHandle } from '../replyNotifications/replyFocus';

/** Layout offsets are relative to different parents; combine them before scrolling the real transcript. */
export function useReplyScroll(input: {
  history: RefObject<ComponentRef<typeof ScrollView> | null>;
  focus?: ReplyFocusHandle;
  followsBottom: RefObject<boolean>;
  expectedOffset: RefObject<number | null>;
}) {
  const state = useRef<{
    generation?: number;
    container?: number;
    message?: number;
    done?: boolean;
  }>({});
  const generation = input.focus?.generation;
  if (state.current.generation !== generation)
    state.current = {
      generation,
      container: state.current.container,
    };
  const reveal = useCallback(() => {
    const current = state.current;
    if (
      !input.focus ||
      current.generation !== generation ||
      current.done ||
      current.container === undefined ||
      current.message === undefined ||
      !input.history.current ||
      !input.focus.canReveal()
    )
      return;
    const y = Math.max(0, current.container + current.message);
    current.done = true;
    input.followsBottom.current = false;
    input.expectedOffset.current = y;
    input.history.current.scrollTo({ y, animated: false });
    input.focus.complete();
  }, [
    generation,
    input.focus,
    input.history,
    input.followsBottom,
    input.expectedOffset,
  ]);
  useEffect(() => {
    if (!input.focus) return;
    // Route authority can become current in a commit after the foreground event.
    reveal();
    // Layout may have arrived while the app was inactive; recheck live ownership on resume.
    const subscription = AppState.addEventListener('change', value => {
      if (value === 'active') reveal();
    });
    return () => subscription.remove();
  }, [reveal, input.focus]);
  return {
    container(y: number) {
      if (state.current.generation !== generation) return;
      state.current.container = y;
      reveal();
    },
    message(y: number) {
      if (state.current.generation !== generation) return;
      state.current.message = y;
      reveal();
    },
  };
}
