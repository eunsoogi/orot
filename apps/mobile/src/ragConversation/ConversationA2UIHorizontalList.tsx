import { useState, type ReactNode } from 'react';
import { a2uiNativeAlignment } from './conversationA2UINativeAlignment';
import type { ConversationA2UIAlignment } from './conversationA2UIAlignment';
import { ScrollView, StyleSheet, View } from 'react-native';

/** One horizontal viewport owned by this bubble. Each bounded-width card
 * stacks any nested horizontal list, and large text stays in reading order. */
export function ConversationA2UIHorizontalList({
  children,
  fontScale,
  alignment,
}: {
  readonly children: readonly { id: string; content: ReactNode }[];
  readonly fontScale: number;
  readonly alignment?: ConversationA2UIAlignment;
}) {
  const [width, setWidth] = useState(0);
  const horizontal = width >= 360 && fontScale <= 1.3;
  return (
    <View
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      testID="conversation-a2ui-list-layout"
    >
      <ScrollView
        horizontal={horizontal}
        scrollEnabled={horizontal}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={
          horizontal && alignment
            ? [styles.items, a2uiNativeAlignment(alignment)]
            : styles.items
        }
        testID={
          horizontal
            ? 'conversation-a2ui-list-strip'
            : 'conversation-a2ui-list-stack'
        }
      >
        {children.map(({ id, content }) => (
          <View key={id} style={horizontal ? styles.card : undefined}>
            {content}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  items: { gap: 8 },
  card: { width: 204 },
});
