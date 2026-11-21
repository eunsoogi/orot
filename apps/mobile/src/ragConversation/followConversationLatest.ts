import { conversationVisibleOffset } from './conversationVisibleOffset';
import type React from 'react';
import type { ScrollView } from 'react-native';

/** Follow new transcript content only while the user has not taken scroll or reply-focus ownership. */
export function followConversationLatest(input: {
  hasMessages: boolean;
  contentHeight?: number;
  bottomInset?: number;
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
    contentHeight,
    bottomInset = 0,
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
  const geometry = scrollGeometry.current;
  const height = viewportHeight.current || geometry?.height || 0;
  const total = contentHeight ?? geometry?.contentHeight;
  const target = compact
    ? messageEnd.current !== null && height > 0
      ? conversationVisibleOffset(messageEnd.current, height, bottomInset)
      : null
    : total === undefined || height === 0
      ? null
      : Math.max(0, total - height);
  const previous = expectedOffset.current ?? geometry?.offset;
  // Native content and row layout can both report the same position. Do not
  // issue a second scroll at the old offset before a real geometry change.
  if (
    target !== null &&
    previous !== undefined &&
    Math.abs(target - previous) < 1
  )
    return;
  if (compact && target === null) return;
  expectedOffset.current = target;
  if (compact && target !== null)
    historyView.current?.scrollTo({ y: target, animated: false });
  else historyView.current?.scrollToEnd({ animated: false });
}
