import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ComponentRef, RefObject } from 'react';
import type {
  NativeSyntheticEvent,
  NativeScrollEvent,
  ScrollView,
} from 'react-native';
import {
  conversationIsNearLatest,
  conversationVisibleOffset,
} from './conversationVisibleOffset';
import { NavigationMotionContext } from '../navigation/NavigationMotionContext';
type Geometry = { height: number; contentHeight: number; offset: number };

/** Read actual scroll geometry without treating keyboard/reflow changes as reader intent. */
export function useConversationJumpToLatest(input: {
  sessionId?: number;
  replyFocusGeneration?: number;
  compact: boolean;
  composerInset: number;
  messageEnd: RefObject<number | null>;
  followsBottom: RefObject<boolean>;
  userScrolling: RefObject<boolean>;
  expectedOffset: RefObject<number | null>;
  scrollGeometry: RefObject<Geometry | null>;
  historyView: RefObject<ComponentRef<typeof ScrollView> | null>;
}) {
  const {
    compact,
    composerInset,
    messageEnd,
    followsBottom,
    userScrolling,
    expectedOffset,
    scrollGeometry,
    historyView,
  } = input;
  const reduceMotion = useContext(NavigationMotionContext);
  const animatedTarget = useRef<number | null>(null);
  const focusGeneration = useRef(input.replyFocusGeneration);
  // A notification focus owns the next scroll, even before its row layout arrives.
  if (focusGeneration.current !== input.replyFocusGeneration) {
    focusGeneration.current = input.replyFocusGeneration;
    animatedTarget.current = null;
    followsBottom.current = false;
  }
  const [away, setAway] = useState(false);
  const measured = useRef<Geometry | null>(null);
  useEffect(() => {
    measured.current = null;
    animatedTarget.current = null;
    setAway(false);
  }, [input.sessionId]);
  const refresh = useCallback(
    (patch?: Partial<Geometry>) => {
      const geometry = {
        height: 0,
        contentHeight: 0,
        offset: 0,
        ...measured.current,
        ...patch,
      };
      measured.current = geometry;
      if (geometry.height <= 0) return;
      const end =
        compact && messageEnd.current !== null
          ? conversationVisibleOffset(
              messageEnd.current,
              geometry.height,
              composerInset,
            )
          : Math.max(0, geometry.contentHeight - geometry.height);
      setAway(animatedTarget.current === null && end - geometry.offset > 8);
    },
    [compact, composerInset, messageEnd],
  );
  // Composer growth can change the visible message end without a scroll event.
  useEffect(() => {
    refresh();
  }, [refresh]);
  // An accessibility preference change must also stop an already running animation.
  useEffect(() => {
    if (!reduceMotion || animatedTarget.current === null) return;
    const y = animatedTarget.current;
    animatedTarget.current = null;
    followsBottom.current = true;
    expectedOffset.current = y;
    historyView.current?.scrollTo({ y, animated: false });
  }, [reduceMotion, followsBottom, expectedOffset, historyView]);
  const onScroll = ({
    nativeEvent,
  }: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
    const previous = scrollGeometry.current;
    const changed =
      previous !== null &&
      (previous.height !== layoutMeasurement.height ||
        previous.contentHeight !== contentSize.height);
    scrollGeometry.current = {
      height: layoutMeasurement.height,
      contentHeight: contentSize.height,
      offset: contentOffset.y,
    };
    if (
      animatedTarget.current !== null &&
      expectedOffset.current !== animatedTarget.current
    )
      animatedTarget.current = null;
    refresh(scrollGeometry.current);
    // Intermediate animation frames are programmatic, not renewed reader intent.
    const target = animatedTarget.current;
    if (target !== null) {
      const clamped = Math.min(
        target,
        Math.max(0, contentSize.height - layoutMeasurement.height),
      );
      if (Math.abs(contentOffset.y - clamped) >= 1) return;
      const latest =
        compact && messageEnd.current !== null
          ? conversationVisibleOffset(
              messageEnd.current,
              layoutMeasurement.height,
              composerInset,
            )
          : Math.max(0, contentSize.height - layoutMeasurement.height);
      if (Math.abs(latest - contentOffset.y) >= 1) {
        animatedTarget.current = latest;
        expectedOffset.current = latest;
        historyView.current?.scrollTo({ y: latest, animated: !reduceMotion });
        return;
      }
      animatedTarget.current = null;
      followsBottom.current = true;
      expectedOffset.current = null;
      refresh(scrollGeometry.current);
      return;
    }
    if (previous && Math.abs(contentOffset.y - previous.offset) < 1) return;
    // Geometry changes and our own offset corrections do not imply reader intent.
    if (changed && !userScrolling.current) {
      expectedOffset.current = null;
      const maximum = Math.max(
        0,
        contentSize.height - layoutMeasurement.height,
      );
      const clampedPrevious = Math.min(Math.max(0, previous.offset), maximum);
      if (
        Math.abs(contentOffset.y - clampedPrevious) < 1 ||
        (followsBottom.current &&
          previous.height !== layoutMeasurement.height &&
          Math.abs(
            previous.offset -
              Math.max(0, previous.contentHeight - previous.height),
          ) < 1 &&
          Math.abs(contentOffset.y - maximum) < 1)
      )
        return;
    }
    const expected = expectedOffset.current;
    expectedOffset.current = null;
    if (
      !userScrolling.current &&
      expected !== null &&
      Math.abs(
        Math.min(
          expected,
          Math.max(0, contentSize.height - layoutMeasurement.height),
        ) - contentOffset.y,
      ) < 1
    )
      return;
    // Only follow streamed content while the reader remains near the bottom.
    followsBottom.current = conversationIsNearLatest(
      compact ? messageEnd.current : null,
      layoutMeasurement.height,
      composerInset,
      contentSize.height,
      contentOffset.y,
    );
  };
  return {
    away,
    refresh,
    onScroll,
    cancelJump() {
      // A real drag owns scrolling immediately, even halfway through a jump.
      if (animatedTarget.current !== null) followsBottom.current = false;
      animatedTarget.current = null;
    },
    jump() {
      // Explicit activation gives following back to the reader, even during generation.
      followsBottom.current = true;
      userScrolling.current = false;
      const geometry = measured.current;
      const y =
        compact && messageEnd.current !== null && geometry
          ? conversationVisibleOffset(
              messageEnd.current,
              geometry.height,
              composerInset,
            )
          : geometry
            ? Math.max(0, geometry.contentHeight - geometry.height)
            : null;
      expectedOffset.current = y;
      const animated = !reduceMotion;
      animatedTarget.current = animated ? y : null;
      // Streaming must not replace the in-flight animation with a nonanimated follow.
      followsBottom.current = animatedTarget.current === null;
      if (y === null) historyView.current?.scrollToEnd({ animated });
      else historyView.current?.scrollTo({ y, animated });
      setAway(false);
    },
  };
}
