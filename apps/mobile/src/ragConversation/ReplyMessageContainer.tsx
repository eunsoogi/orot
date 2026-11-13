import type { ReactNode } from 'react';
import { View } from 'react-native';

/** A focused message reports its offset within the transcript message container. */
export function ReplyMessageContainer({
  focused,
  onLayout,
  children,
}: {
  focused: boolean;
  onLayout(y: number): void;
  children: ReactNode;
}) {
  return (
    <View
      testID={focused ? 'conversation-reply-focus' : undefined}
      onLayout={
        focused ? event => onLayout(event.nativeEvent.layout.y) : undefined
      }
    >
      {children}
    </View>
  );
}
