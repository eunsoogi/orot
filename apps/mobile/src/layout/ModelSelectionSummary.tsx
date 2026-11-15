import { StyleSheet, View } from 'react-native';
import { AppText as Text } from './AppText';
import { appColors } from './appColors';

/** Saved identity is informational, never a selectable row or an availability claim. */
export function ModelSelectionSummary({
  label,
  value,
  testID,
}: {
  readonly label?: string;
  readonly value: string;
  readonly testID: string;
}) {
  return (
    <View style={styles.card} testID={testID + '-card'}>
      <Text testID={testID}>
        {label ? <Text style={styles.label}>{label + '\n'}</Text> : null}
        <Text style={styles.value}>{value}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Unlike account shells, this card has no padded child row: own the full inset.
  card: {
    padding: 16,
    borderRadius: 20,
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderWidth: 1,
  },
  label: { fontSize: 13, lineHeight: 22, color: appColors.secondary },
  value: {
    fontSize: 17,
    lineHeight: 25,
    fontWeight: '600',
    color: appColors.text,
  },
});
