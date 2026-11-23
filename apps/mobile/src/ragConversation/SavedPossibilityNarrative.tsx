import { StyleSheet, View } from 'react-native';
import { AppText } from '../layout/AppText';
import type { NarrativePart } from './savedPossibilityNarrativeParts';
import { styles as conversationStyles } from './ConversationScreen.styles';

export function SavedPossibilityNarrative({
  parts,
  testID,
  selectable,
}: {
  readonly parts: readonly NarrativePart[];
  readonly testID?: string;
  readonly selectable?: boolean;
}) {
  return (
    <View testID={testID} style={styles.narrative}>
      {parts.map(({ kind, text }, index) => (
        <AppText
          key={index}
          selectable={selectable}
          accessibilityRole={kind === 'heading' ? 'header' : undefined}
          style={[
            conversationStyles.messageText,
            kind === 'heading' && styles.heading,
          ]}
        >
          {text}
        </AppText>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  narrative: { gap: 6 },
  heading: { fontWeight: '600' },
});
