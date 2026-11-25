import type { ConversationLayoutSkeleton } from '@orot/agent-runtime';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { appColors } from '../layout/appColors';
import { styles as conversation } from './ConversationScreen.styles';

const slots = [0, 1, 2] as const;

/** Decorative: no model values or accessible text, and no animated placeholders. */
export function ConversationA2UILiveSkeleton({
  layout,
}: {
  readonly layout: ConversationLayoutSkeleton;
}) {
  const { fontScale } = useWindowDimensions();
  const row = layout.kind === 'row' && fontScale < 1.4;
  return (
    <View
      testID={row ? 'conversation-a2ui-skeleton-row' : 'conversation-a2ui-skeleton'}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[conversation.assistantMessage, styles.surface, row && styles.row]}
    >
      {slots.slice(0, layout.slots).map(slot => (
        <View key={slot} style={[styles.line, row && styles.cell]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { padding: 12, gap: 8, minWidth: 120 },
  row: { flexDirection: 'row', width: 160 },
  line: { height: 8, borderRadius: 4, backgroundColor: appColors.primarySoft },
  cell: { flex: 1 },
});
