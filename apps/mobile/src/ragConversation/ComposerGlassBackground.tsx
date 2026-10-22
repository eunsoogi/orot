import {
  Platform,
  requireNativeComponent,
  StyleSheet,
  View,
  type ViewProps,
} from 'react-native';
import { appColors } from '../layout/appColors';

const NativeGlass =
  Platform.OS === 'ios'
    ? requireNativeComponent<ViewProps>('ComposerGlassView')
    : null;

/** Shared material never consumes touches; the surrounding React controls retain accessibility and actions. */
export function ComposerGlassBackground({
  testID,
}: { readonly testID?: string } = {}) {
  return NativeGlass ? (
    <NativeGlass
      testID={testID}
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
    />
  ) : (
    <View
      testID={testID}
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: appColors.surface }]}
    />
  );
}
