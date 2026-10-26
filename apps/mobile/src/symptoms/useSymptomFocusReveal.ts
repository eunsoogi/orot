import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import type { RefObject } from 'react';
import { Keyboard } from 'react-native';
import type {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollViewInstance,
  TextInputInstance,
} from 'react-native';

/** Reveals the focused field using native window geometry, without changing focus or synthesizing a drag. */
export default function useSymptomFocusReveal(
  scroll: RefObject<ScrollViewInstance | null>,
  bottomInset: number,
) {
  const focused = useRef<TextInputInstance | null>(null);
  const offset = useRef(0);
  const generation = useRef(0);
  const lastCorrection = useRef<{
    input: TextInputInstance;
    geometry: string;
  } | null>(null);
  const revealFocused = useCallback(() => {
    const input = focused.current;
    const scroller = scroll.current;
    const host = scroller?.getNativeScrollRef();
    const request = ++generation.current;
    if (!input?.isFocused() || !host || !scroller) return;
    host.measureInWindow((_x, top, width, height) => {
      input.measureInWindow((_inputX, inputTop, inputWidth, inputHeight) => {
        // A focus/viewport change can overtake either asynchronous native measurement.
        if (
          request !== generation.current ||
          focused.current !== input ||
          !input.isFocused()
        )
          return;
        const keyboardTop = Keyboard.metrics()?.screenY ?? Infinity;
        const bottom = Math.min(top + height, keyboardTop) - bottomInset;
        if (
          ![
            top,
            width,
            height,
            inputTop,
            inputWidth,
            inputHeight,
            bottom,
          ].every(Number.isFinite) ||
          width <= 0 ||
          height <= 0 ||
          inputWidth <= 0 ||
          inputHeight <= 0 ||
          bottom <= top
        )
          return;
        // An oversized multiline editor cannot fit in full; align its top instead of oscillating between edges.
        const delta =
          inputTop < top || inputHeight > bottom - top
            ? inputTop - top
            : Math.max(0, inputTop + inputHeight - bottom);
        if (delta === 0) return;
        const geometry = [
          top,
          bottom,
          inputTop,
          inputHeight,
          offset.current,
        ].join(':');
        if (
          lastCorrection.current?.input === input &&
          lastCorrection.current.geometry === geometry
        )
          return;
        lastCorrection.current = { input, geometry };
        scroller.scrollTo({
          y: Math.max(0, offset.current + delta),
          animated: false,
        });
      });
    });
  }, [bottomInset, scroll]);

  const focusInput = useCallback(
    (input: TextInputInstance | null) => {
      focused.current = input;
      lastCorrection.current = null;
      revealFocused();
    },
    [revealFocused],
  );
  const blurInput = useCallback((input: TextInputInstance | null) => {
    if (focused.current !== input) return;
    focused.current = null;
    generation.current += 1;
  }, []);
  const onScroll = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
      // Observe the real content offset; scrolling itself must not start a reveal loop or fight a user's drag.
      offset.current = nativeEvent.contentOffset.y;
    },
    [],
  );
  useLayoutEffect(revealFocused, [revealFocused]);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  useEffect(() => {
    const subscriptions = [
      Keyboard.addListener('keyboardDidShow', revealFocused),
      Keyboard.addListener('keyboardDidChangeFrame', revealFocused),
    ];
    return () => {
      subscriptions.forEach(subscription => subscription.remove());
    };
  }, [revealFocused]);
  return useMemo(
    () => ({ focusInput, blurInput, revealFocused, onScroll }),
    [focusInput, blurInput, revealFocused, onScroll],
  );
}
