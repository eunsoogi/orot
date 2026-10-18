import {
  ActivityIndicator,
  Platform,
  requireNativeComponent,
  StyleSheet,
  View,
  type ColorValue,
  type ViewProps,
} from 'react-native';

interface Props extends ViewProps {
  readonly animating?: boolean;
  readonly color?: ColorValue;
  readonly size?: 'small' | 'large';
}

interface NativeProps extends ViewProps {
  readonly active: boolean;
  readonly color: ColorValue;
  readonly large: boolean;
}

const NativeProgress =
  Platform.OS === 'ios'
    ? requireNativeComponent<NativeProps>('AppProgressView')
    : null;

/** Retain normal visible progress while the native view stops its animation on removal. */
export function AppProgress({
  animating = true,
  color = '#999999',
  size = 'small',
  style,
  onLayout,
  ...props
}: Props) {
  if (!NativeProgress) {
    return (
      <ActivityIndicator
        {...props}
        animating={animating}
        color={color}
        size={size}
        style={style}
        onLayout={onLayout}
      />
    );
  }
  return (
    <View style={[styles.container, style]} onLayout={onLayout}>
      <NativeProgress
        {...props}
        active={animating}
        color={color}
        large={size === 'large'}
        style={size === 'large' ? styles.large : styles.small}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
  small: { width: 20, height: 20 },
  large: { width: 36, height: 36 },
});
