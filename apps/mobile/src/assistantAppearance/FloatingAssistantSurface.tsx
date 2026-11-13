import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ConversationSession } from '../ragConversation/conversationSessionTypes';
import { useAssistantAppearance } from './AssistantAppearanceProvider';
import { AssistantHeader } from './AssistantHeader';

/** Float within the already safe, adaptive content panel, never against window coordinates. */
export function FloatingAssistantSurface({
  session,
  children,
}: {
  session: ConversationSession;
  children: ReactNode;
}) {
  const [height, setHeight] = useState(0);
  const appearance = useAssistantAppearance();
  if (!appearance?.ready) return <>{children}</>;
  return (
    <View style={styles.surface} testID="assistant-floating-surface">
      {/* Reserve only measured identity height so controls remain reachable under the overlay. */}
      <View style={[styles.surface, { paddingTop: height }]}>{children}</View>
      <View
        pointerEvents="box-none"
        style={styles.overlay}
        testID="assistant-floating-overlay"
        onLayout={event => setHeight(event.nativeEvent.layout.height)}
      >
        <AssistantHeader session={session} />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  surface: { flex: 1, minHeight: 0 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    zIndex: 1,
  },
});
