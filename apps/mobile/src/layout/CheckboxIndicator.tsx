import { StyleSheet, View } from 'react-native';
import type { ColorValue } from 'react-native';
import { AppSymbol } from './AppSymbol';
import { appColors } from './appColors';
import { COMPACT_APP_SYMBOL_POINT_SIZE } from './iconSizing';

export type CheckboxValue = boolean | 'mixed';

export function checkboxSymbolName(checked: CheckboxValue): string {
  if (checked === 'mixed') return 'minus.square.fill';
  return checked ? 'checkmark.square.fill' : 'square';
}

/** Draws a decorative checkbox icon; its enclosing control owns accessible state. */
export function CheckboxIndicator({
  checked,
  color = appColors.primaryText,
  disabled = false,
  testID,
}: {
  readonly checked: CheckboxValue;
  readonly color?: ColorValue;
  readonly disabled?: boolean;
  readonly testID?: string;
}) {
  return (
    <View style={[styles.target, disabled && styles.disabled]} testID={testID}>
      <View
        style={styles.glyph}
        testID={testID ? `${testID}-glyph` : undefined}
      >
        <AppSymbol name={checkboxSymbolName(checked)} color={color} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  target: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The 44pt target centers this compact frame without shrinking the control.
  glyph: {
    width: COMPACT_APP_SYMBOL_POINT_SIZE,
    height: COMPACT_APP_SYMBOL_POINT_SIZE,
  },
  disabled: { opacity: 0.45 },
});
