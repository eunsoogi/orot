import {
  Platform,
  requireNativeComponent,
  StyleSheet,
  View,
  type ViewProps,
} from 'react-native';
import { appColors } from './appColors';

const NativeGlass =
  Platform.OS === 'ios'
    ? requireNativeComponent<ViewProps>('ComposerGlassView')
    : null;

/** Wraps the existing UIKit Glass surface without taking over its host’s touch or accessibility handling. */
export function NativeGlassBackdrop({
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
