import {
  Platform,
  Pressable,
  View,
  StyleSheet,
  requireNativeComponent,
  type ViewProps,
} from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { styles } from './ConversationScreen.styles';

interface NativeProps extends ViewProps {
  busy: boolean;
  disabled: boolean;
  actionLabel: string;
  actionTestID: string;
  onComposerPress: () => void;
}
const NativeGlassAction =
  Platform.OS === 'ios'
    ? requireNativeComponent<NativeProps>('ComposerGlassActionView')
    : null;

/** UIKit owns the grouped input material and action; React text stays above its matching input region. */
export function ConversationGlassAction({
  busy,
  disabled,
  label,
  onPress,
}: {
  busy: boolean;
  disabled: boolean;
  label: string;
  onPress: () => void;
}) {
  const testID = busy ? 'rag-conversation-cancel' : 'rag-conversation-send';
  return NativeGlassAction ? (
    <NativeGlassAction
      busy={busy}
      disabled={disabled}
      actionLabel={label}
      actionTestID={testID}
      // Only UIKit's 44pt UIButton is an accessibility action; this host spans the input material too.
      accessible={false}
      onComposerPress={onPress}
      style={StyleSheet.absoluteFill}
      testID={testID}
    />
  ) : (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { right: 52, backgroundColor: appColors.surface, borderRadius: 28 },
        ]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy, disabled }}
        disabled={disabled}
        onPress={onPress}
        style={[
          styles.send,
          { position: 'absolute', right: 0, bottom: 0 },
          disabled && styles.disabled,
        ]}
        testID={testID}
      >
        <AppSymbol
          name={busy ? 'stop.fill' : 'arrow.up'}
          size={22}
          color={appColors.text}
        />
      </Pressable>
    </View>
  );
}
