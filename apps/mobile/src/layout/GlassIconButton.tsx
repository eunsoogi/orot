import {
  Platform,
  StyleSheet,
  Pressable,
  requireNativeComponent,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { AppSymbol } from './AppSymbol';
import { appColors } from './appColors';

interface NativeProps extends ViewProps {
  symbolName: string;
  actionLabel: string;
  actionHint: string;
  actionTestID: string;
  disabled: boolean;
  busy: boolean;
  onAction: () => void;
}
const NativeButton =
  Platform.OS === 'ios'
    ? requireNativeComponent<NativeProps>('GlassIconButton')
    : null;

/** Native UIKit owns the whole action; no transparent ancestor or duplicate React touch target. */
export function GlassIconButton({
  symbolName,
  accessibilityLabel,
  accessibilityHint = '',
  accessibilityState,
  disabled = false,
  onPress,
  style,
  testID = '',
}: {
  readonly symbolName: string;
  readonly accessibilityLabel: string;
  readonly accessibilityHint?: string;
  readonly accessibilityRole?: 'button';
  readonly accessibilityState?: { disabled?: boolean; busy?: boolean };
  readonly disabled?: boolean;
  readonly onPress?: () => void;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}) {
  // Mirror the native guard at the bridge boundary: stale queued events cannot activate a disabled action.
  const invoke = () => {
    if (!disabled) onPress?.();
  };
  return NativeButton ? (
    <NativeButton
      symbolName={symbolName}
      actionLabel={accessibilityLabel}
      actionHint={accessibilityHint}
      actionTestID={testID}
      disabled={disabled}
      busy={accessibilityState?.busy ?? false}
      onAction={invoke}
      // Let UIKit shape and render its effect without a second React mask.
      style={[style, styles.native]}
      testID={testID}
    />
  ) : (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ ...accessibilityState, disabled }}
      disabled={disabled}
      onPress={invoke}
      style={style}
      testID={testID}
    >
      <AppSymbol
        name={symbolName}
        color={disabled ? appColors.secondary : appColors.text}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  native: { borderRadius: 0, overflow: 'visible' },
});
