import { useCallback, useEffect, useRef, useState } from 'react';
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
type Geometry = { height: number; contentHeight: number; offset: number };

/** Read actual scroll geometry without treating keyboard/reflow changes as reader intent. */
export function useConversationJumpToLatest(input: {
  sessionId?: number;
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
  const [away, setAway] = useState(false);
  const measured = useRef<Geometry | null>(null);
  useEffect(() => {
    measured.current = null;
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
      setAway(end - geometry.offset > 8);
    },
    [compact, composerInset, messageEnd],
  );
  // Composer growth can change the visible message end without a scroll event.
  useEffect(() => {
    refresh();
  }, [refresh]);
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
    refresh(scrollGeometry.current);
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
      if (y === null) historyView.current?.scrollToEnd({ animated: false });
      else historyView.current?.scrollTo({ y, animated: false });
      setAway(false);
    },
  };
}
