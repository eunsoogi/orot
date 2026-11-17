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
  return {
    onLayout: ({ nativeEvent }) => {
      viewportHeight.current = nativeEvent.layout.height;
      jumpControl.refresh({ height: nativeEvent.layout.height });
      followLatest();
    },
    onContentSizeChange: (_width, height) => {
      jumpControl.refresh({
        height: viewportHeight.current,
        contentHeight: height,
      });
      followLatest();
    },
    onScrollBeginDrag: () => {
      reading.cancel();
      jumpControl.cancelJump();
      window.cancelAnchor();
      userScrolling.current = true;
      expectedOffset.current = null;
    },
    onScrollEndDrag: () => {
      userScrolling.current = false;
      reading.save();
    },
    onMomentumScrollBegin: () => {
      userScrolling.current = true;
    },
    onMomentumScrollEnd: () => {
      userScrolling.current = false;
      reading.save();
    },
    onScroll: event => {
      jumpControl.onScroll(event);
      window.onTopEdge(
        event.nativeEvent.contentOffset.y,
        userScrolling.current,
      );
    },
    onScrollToTop: () => {
      reading.cancel();
      jumpControl.cancelJump();
      expectedOffset.current = null;
      followsBottom.current = false;
      reading.save({ offset: 0, bottom: false });
    },
  };
}
