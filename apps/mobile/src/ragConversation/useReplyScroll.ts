import { useRef } from 'react';
import type { ComponentRef, RefObject } from 'react';
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
  const reveal = () => {
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
  };
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
