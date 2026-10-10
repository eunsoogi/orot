import type { ReactNode } from 'react';
import {
  Platform,
  requireNativeComponent,
  StyleSheet,
  View,
  type ViewProps,
} from 'react-native';

interface NavigationGlassNativeProps extends ViewProps {
  readonly testID?: string;
  readonly children?: ReactNode;
}

const NativeNavigationGlassSurface =
  Platform.OS === 'ios'
    ? requireNativeComponent<NavigationGlassNativeProps>('NavigationGlassView')
    : null;

export function NavigationGlassSurface({
  children,
  style,
  testID,
}: NavigationGlassNativeProps) {
  if (NativeNavigationGlassSurface) {
    return (
      <NativeNavigationGlassSurface
        pointerEvents="box-none"
        style={[styles.surface, style]}
        testID={testID}
      >
        {children}
      </NativeNavigationGlassSurface>
    );
  }

  return (
    <View style={[styles.fallback, style]} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    flexShrink: 0,
    paddingBottom: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  fallback: {
    backgroundColor: '#f7f8fa',
    borderTopColor: '#52616d',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
});
