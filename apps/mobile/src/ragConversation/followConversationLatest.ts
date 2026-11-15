import type React from 'react';
import type { ScrollView } from 'react-native';

/** Follow new transcript content only while the user has not taken scroll or reply-focus ownership. */
export function followConversationLatest(input: {
  hasMessages: boolean;
  compact: boolean;
  focused: boolean;
  followsBottom: React.RefObject<boolean>;
  messageEnd: React.RefObject<number | null>;
  viewportHeight: React.RefObject<number>;
  expectedOffset: React.RefObject<number | null>;
  historyView: React.RefObject<React.ComponentRef<typeof ScrollView> | null>;
  scrollGeometry: React.RefObject<{
    height: number;
    contentHeight: number;
    offset: number;
  } | null>;
}) {
  const {
    hasMessages,
    compact,
    focused,
    followsBottom,
    messageEnd,
    viewportHeight,
    expectedOffset,
    historyView,
    scrollGeometry,
  } = input;
  if (!hasMessages || !followsBottom.current || focused) return;
  if (compact) {
    if (messageEnd.current !== null && viewportHeight.current > 0) {
      expectedOffset.current = Math.max(
        0,
        messageEnd.current - viewportHeight.current,
      );
      historyView.current?.scrollTo({
        y: expectedOffset.current,
        animated: false,
      });
    }
  } else {
    const geometry = scrollGeometry.current;
    expectedOffset.current = geometry
      ? Math.max(0, geometry.contentHeight - geometry.height)
      : null;
    historyView.current?.scrollToEnd({ animated: false });
  }
}
