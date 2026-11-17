import type { ReactNode } from 'react';
import { View } from 'react-native';

/** A focused message reports its offset within the transcript message container. */
export function ReplyMessageContainer({
  focused,
  onLayout,
  children,
  onPosition,
}: {
  focused: boolean;
  onLayout(y: number): void;
  children: ReactNode;
  onPosition?: (y: number) => void;
}) {
  return (
    <View
      testID={
        focused
          ? 'conversation-reply-focus'
          : onPosition
            ? 'conversation-earlier-anchor'
            : undefined
      }
      onLayout={
        focused || onPosition
          ? event => {
              const y = event.nativeEvent.layout.y;
              if (focused) onLayout(y);
              onPosition?.(y);
            }
          : undefined
      }
    >
      {children}
    </View>
  );
}
