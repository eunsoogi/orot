import type { ReactNode } from 'react';
import { NAVIGATION_SURFACE_HEIGHT } from './navigationLayout';
import {
  type NativeSyntheticEvent,
  Platform,
  requireNativeComponent,
  StyleSheet,
  useColorScheme,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

export interface NavigationGlassAction {
  readonly id: string;
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly testID: string;
  readonly systemImageName?: string;
  readonly disabled?: boolean;
  readonly primary?: boolean;
}

export interface NavigationGlassActionEvent {
  readonly id: string;
}

export type NavigationGlassActionEventHandler = (
  event: NativeSyntheticEvent<NavigationGlassActionEvent>,
) => void;

export interface NavigationGlassSurfaceProps {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID: string;
  readonly actions?: readonly NavigationGlassAction[];
  readonly onAction?: NavigationGlassActionEventHandler;
}

interface NavigationGlassNativeProps extends ViewProps {
  readonly actions?: readonly NavigationGlassAction[];
  readonly onAction?: NavigationGlassActionEventHandler;
}

const NativeNavigationGlassSurface =
  Platform.OS === 'ios'
    ? requireNativeComponent<NavigationGlassNativeProps>('NavigationGlassView')
    : null;

export function NavigationGlassSurface({
  actions = [],
  children,
  onAction,
  style,
  testID,
}: NavigationGlassSurfaceProps) {
  const isDarkAppearance = useColorScheme() === 'dark';

  if (NativeNavigationGlassSurface) {
    return (
      <NativeNavigationGlassSurface
        actions={actions}
        onAction={onAction}
        style={[styles.surface, style]}
        testID={testID}
      />
    );
  }

  return (
    <View
      style={[styles.fallback, isDarkAppearance && styles.darkFallback, style]}
      testID={testID}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    flexShrink: 0,
    height: NAVIGATION_SURFACE_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  fallback: {
    backgroundColor: '#ffffff',
    borderRadius: 28,
    paddingBottom: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  darkFallback: { backgroundColor: '#191f28' },
});
