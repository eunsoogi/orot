import { useRef } from 'react';
import type { ComponentRef, RefObject } from 'react';
import type { ScrollView } from 'react-native';

/** Layout offsets are relative to different parents; combine them before scrolling the real transcript. */
export function useReplyScroll(input: {
  history: RefObject<ComponentRef<typeof ScrollView> | null>;
  focus?: { messageId: string; done(): void };
  followsBottom: RefObject<boolean>;
  expectedOffset: RefObject<number | null>;
}) {
  const state = useRef<{
    key?: string;
    container?: number;
    message?: number;
    done?: boolean;
  }>({});
  if (state.current.key !== input.focus?.messageId)
    state.current = {
      key: input.focus?.messageId,
      container: state.current.container,
    };
  const reveal = () => {
    const current = state.current;
    if (
      !input.focus ||
      current.done ||
      current.container === undefined ||
      current.message === undefined
    )
      return;
    const y = Math.max(0, current.container + current.message);
    current.done = true;
    input.followsBottom.current = false;
    input.expectedOffset.current = y;
    input.history.current?.scrollTo({ y, animated: false });
    input.focus.done();
  };
  return {
    container(y: number) {
      state.current.container = y;
      reveal();
    },
    message(y: number) {
      state.current.message = y;
      reveal();
    },
  };
}
