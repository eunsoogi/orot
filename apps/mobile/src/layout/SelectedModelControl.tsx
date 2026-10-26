import { Pressable, StyleSheet, View } from 'react-native';
import { AppSymbol } from './AppSymbol';
import { AppText } from './AppText';
import { appColors } from './appColors';

interface Props {
  readonly name: string;
  readonly local: boolean;
  readonly label?: string;
  readonly hint?: string;
  readonly busy?: boolean;
  readonly onPress?: () => void;
  readonly testID?: string;
}

/** Shared mockup model line; read-only uses no button role or disclosure affordance. */
export function SelectedModelControl({
  name,
  local,
  label,
  hint,
  busy,
  onPress,
  testID,
}: Props) {
  const content = (
    <>
      <AppSymbol
        name={local ? 'apple.logo' : 'sparkles'}
        size={20}
        color={appColors.primaryText}
      />
      <AppText style={styles.name}>{name}</AppText>
      {onPress ? (
        <AppSymbol name="chevron.down" size={12} color={appColors.secondary} />
      ) : null}
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? name}
      accessibilityHint={hint}
      accessibilityState={{ busy: Boolean(busy) }}
      onPress={onPress}
      style={styles.row}
      testID={testID}
    >
      {content}
    </Pressable>
  ) : (
    <View style={styles.row} testID={testID}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    maxWidth: '100%',
  },
  name: {
    flexShrink: 1,
    color: appColors.text,
    fontSize: 16,
    fontWeight: '600',
  },
});
