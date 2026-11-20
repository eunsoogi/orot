import { syntheticTranscriptScrollTrace } from './syntheticTranscriptScrollTrace';
import type { ScrollViewProps } from 'react-native';
import type { useConversationReadingPosition } from './useConversationReadingPosition';
import type { useConversationJumpToLatest } from './useConversationJumpToLatest';
import type { useConversationTranscriptWindow } from './useConversationTranscriptWindow';
/** Preserve event ordering: reader intent cancels restoration before paging or bottom-follow decisions. */
export function conversationHistoryScrollEvents({
  reading,
  viewportHeight,
  followLatest,
  jumpControl,
  window,
  userScrolling,
  expectedOffset,
  followsBottom,
}: {
  viewportHeight: { current: number };
  followLatest: () => unknown;
  reading: ReturnType<typeof useConversationReadingPosition>;
  jumpControl: ReturnType<typeof useConversationJumpToLatest>;
  window: ReturnType<typeof useConversationTranscriptWindow>;
  userScrolling: { current: boolean };
  expectedOffset: { current: number | null };
  followsBottom: { current: boolean };
}): Pick<
  ScrollViewProps,
  | 'onLayout'
  | 'onContentSizeChange'
  | 'onScrollBeginDrag'
  | 'onScrollEndDrag'
  | 'onMomentumScrollBegin'
  | 'onMomentumScrollEnd'
  | 'onScroll'
  | 'onScrollToTop'
> {
  const trace = syntheticTranscriptScrollTrace();
  const state =
    trace &&
    ((boundary: Parameters<NonNullable<typeof trace>>[0]) =>
      trace(
        boundary,
        null,
        followsBottom.current,
        userScrolling.current,
        expectedOffset.current,
      ));
  return {
    onLayout: ({ nativeEvent }) => {
      trace?.(
        'layout',
        nativeEvent.layout,
        followsBottom.current,
        userScrolling.current,
        expectedOffset.current,
      );
      viewportHeight.current = nativeEvent.layout.height;
      jumpControl.refresh({ height: nativeEvent.layout.height });
      followLatest();
    },
    onContentSizeChange: (_width, height) => {
      trace?.(
        'content-size',
        {
          width: _width,
          height: viewportHeight.current,
          contentHeight: height,
        },
        followsBottom.current,
        userScrolling.current,
        expectedOffset.current,
      );
      jumpControl.refresh({
        height: viewportHeight.current,
        contentHeight: height,
      });
      followLatest();
    },
    onScrollBeginDrag: () => {
      state?.('drag-begin');
      reading.cancel();
      jumpControl.cancelJump();
      window.cancelAnchor();
      userScrolling.current = true;
      expectedOffset.current = null;
    },
    onScrollEndDrag: () => {
      state?.('drag-end');
      userScrolling.current = false;
      reading.save();
    },
    onMomentumScrollBegin: () => {
      state?.('inertia-begin');
      userScrolling.current = true;
    },
    onMomentumScrollEnd: () => {
      state?.('inertia-end');
      userScrolling.current = false;
      reading.save();
    },
    onScroll: event => {
      const sample = trace && {
        width: event.nativeEvent.layoutMeasurement.width,
        height: event.nativeEvent.layoutMeasurement.height,
        contentHeight: event.nativeEvent.contentSize.height,
        offset: event.nativeEvent.contentOffset.y,
      };
      if (sample)
        trace?.(
          'scroll-before',
          sample,
          followsBottom.current,
          userScrolling.current,
          expectedOffset.current,
        );
      jumpControl.onScroll(event);
      if (sample)
        trace?.(
          'scroll-after',
          sample,
          followsBottom.current,
          userScrolling.current,
          expectedOffset.current,
        );
      window.onTopEdge(
        event.nativeEvent.contentOffset.y,
        userScrolling.current,
      );
    },
    onScrollToTop: () => {
      // RN provides completion, not the request or cause of earlier scroll events.
      state?.('status-bar-top-completed');
      reading.cancel();
      jumpControl.cancelJump();
      expectedOffset.current = null;
      followsBottom.current = false;
      reading.save({ offset: 0, bottom: false });
    },
  };
}
