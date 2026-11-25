import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

/** One horizontal viewport owned by this bubble. Each bounded-width card
 * stacks any nested horizontal list, and large text stays in reading order. */
export function ConversationA2UIHorizontalList({
  children,
  fontScale,
}: {
  readonly children: readonly { id: string; content: ReactNode }[];
  readonly fontScale: number;
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
        contentContainerStyle={styles.items}
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
