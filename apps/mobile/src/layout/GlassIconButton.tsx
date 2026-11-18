import {
  Platform,
  View,
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
  visualScale: number;
  actionLabel: string;
  actionHint: string;
  actionTestID: string;
  disabled: boolean;
  busy: boolean;
  onGlassIconPress: () => void;
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
  visualScale = 1,
}: {
  readonly visualScale?: number;
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
  const scale = Number.isFinite(visualScale)
    ? Math.max(0.5, Math.min(1, visualScale))
    : 1;
  // Mirror the native guard at the bridge boundary: stale queued events cannot activate a disabled action.
  const invoke = () => {
    if (!disabled) onPress?.();
  };
  return NativeButton ? (
    <NativeButton
      symbolName={symbolName}
      visualScale={scale}
      actionLabel={accessibilityLabel}
      actionHint={accessibilityHint}
      actionTestID={testID}
      disabled={disabled}
      busy={accessibilityState?.busy ?? false}
      onGlassIconPress={invoke}
      // Let UIKit shape and render its effect without a second React mask.
      style={[style, styles.native]}
      // actionTestID belongs to UIButton; a React testID also labels its Fabric wrapper.
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
      <View pointerEvents="none" style={{ transform: [{ scale }] }}>
        <AppSymbol
          name={symbolName}
          color={disabled ? appColors.secondary : appColors.text}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // UIKit owns the border. A React border shrinks the bridged control inside its layout box.
  native: { borderRadius: 0, borderWidth: 0, overflow: 'visible' },
});
