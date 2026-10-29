import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import type { RefObject } from 'react';
import { Keyboard } from 'react-native';
import { observeSymptomFocus } from './symptomFocusDiagnostics';
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
    const hasFocus = input?.isFocused() ?? false;
    observeSymptomFocus('measurement-start', request, {
      hasFocus,
      bottomInset,
      offset: offset.current,
    });
    if (!hasFocus || !input || !host || !scroller) {
      observeSymptomFocus('unavailable-focus-or-host', request, {
        hasFocus,
        hasHost: !!host,
        hasScroller: !!scroller,
      });
      return;
    }
    host.measureInWindow((x, top, width, height) => {
      observeSymptomFocus('host-measured', request, { x, top, width, height });
      input.measureInWindow((inputX, inputTop, inputWidth, inputHeight) => {
        // A focus/viewport change can overtake either asynchronous native measurement.
        if (
          request !== generation.current ||
          focused.current !== input ||
          !input.isFocused()
        ) {
          observeSymptomFocus('obsolete-or-blurred', request, {
            currentGeneration: generation.current,
          });
          return;
        }
        const keyboardTop = Keyboard.metrics()?.screenY ?? Infinity;
        const bottom = Math.min(top + height, keyboardTop) - bottomInset;
        observeSymptomFocus('input-measured', request, {
          inputX,
          inputTop,
          inputWidth,
          inputHeight,
          scrollBottom: top + height,
          keyboardTop,
          bottomInset,
          bottom,
          offset: offset.current,
        });
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
        ) {
          observeSymptomFocus('invalid-geometry', request);
          return;
        }
        // An oversized multiline editor cannot fit in full; align its top instead of oscillating between edges.
        const delta =
          inputTop < top || inputHeight > bottom - top
            ? inputTop - top
            : Math.max(0, inputTop + inputHeight - bottom);
        if (delta === 0) {
          observeSymptomFocus('already-visible', request);
          return;
        }
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
        ) {
          observeSymptomFocus('duplicate-correction', request);
          return;
        }
        lastCorrection.current = { input, geometry };
        // A request is not proof of application: the next native scroll event records the observed offset.
        observeSymptomFocus('scroll-requested', request, {
          delta,
          offset: offset.current,
          desiredOffset: offset.current + delta,
          requestedOffset: Math.max(0, offset.current + delta),
        });
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
      observeSymptomFocus('scroll-observed', generation.current, {
        offset: nativeEvent.contentOffset.y,
        contentHeight: nativeEvent.contentSize?.height ?? null,
        viewportHeight: nativeEvent.layoutMeasurement?.height ?? null,
        insetTop: nativeEvent.contentInset?.top ?? null,
        insetBottom: nativeEvent.contentInset?.bottom ?? null,
      });
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
