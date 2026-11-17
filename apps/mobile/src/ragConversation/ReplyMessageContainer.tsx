import type { ReactNode } from 'react';
import { View } from 'react-native';

/** A focused message reports its offset within the transcript message container. */
export function ReplyMessageContainer({
  focused,
  onLayout,
  children,
  onPosition,
  onFrame,
  readingId,
}: {
  readingId?: number;
  focused: boolean;
  onLayout(y: number): void;
  children: ReactNode;
  onPosition?: (y: number) => void;
  onFrame?: (y: number, height: number) => void;
}) {
  return (
    <View
      testID={
        focused
          ? 'conversation-reply-focus'
          : onPosition
            ? 'conversation-earlier-anchor'
            : readingId !== undefined
              ? `conversation-reading-row-${readingId}`
              : undefined
      }
      onLayout={
        focused || onPosition || onFrame
          ? event => {
              const y = event.nativeEvent.layout.y;
              if (focused) onLayout(y);
              onPosition?.(y);
              onFrame?.(y, event.nativeEvent.layout.height);
            }
          : undefined
      }
    >
      {children}
    </View>
  );
}
