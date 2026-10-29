import { useContext, type ReactNode } from 'react';
import { NavigationOverlayLayoutContext } from './navigationOverlayLayout';
import {
  NAVIGATION_SURFACE_HEIGHT,
  ROOT_TAB_SURFACE_HEIGHT,
} from './navigationLayout';
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
  readonly selected?: boolean;
  /** Keeps root-only sizing and selected glass from leaking into contextual actions. */
  readonly rootTab?: boolean;
  readonly showsTitleWithSystemImage?: boolean;
  readonly titleBelowImage?: boolean;
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
  readonly layoutMode?: 'bottom' | 'left' | 'right';
  readonly railTopInset?: number;
  readonly railBottomInset?: number;
  readonly railRightInset?: number;
  /** Explicit window extent after keyboard avoidance, independent of React host bounds. */
  readonly railAvailableHeight?: number;
}

interface NavigationGlassNativeProps extends ViewProps {
  readonly geometryLayoutRevision?: string;
  readonly actions?: readonly NavigationGlassAction[];
  readonly onAction?: NavigationGlassActionEventHandler;
  readonly layoutMode?: 'bottom' | 'left' | 'right';
  readonly railTopInset?: number;
  readonly railBottomInset?: number;
  readonly railRightInset?: number;
  readonly railAvailableHeight?: number;
}

const NativeNavigationGlassSurface =
  Platform.OS === 'ios'
    ? requireNativeComponent<NavigationGlassNativeProps>('NavigationGlassView')
    : null;

export function NavigationGlassSurface({
  actions = [],
  children,
  layoutMode,
  onAction,
  railBottomInset,
  railRightInset,
  railTopInset,
  railAvailableHeight,
  style,
  testID,
}: NavigationGlassSurfaceProps) {
  const overlay = useContext(NavigationOverlayLayoutContext);
  // Wait for the overlay's own layout event; a viewport event can precede its final position.
  const geometryLayoutRevision = overlay
    ? JSON.stringify([overlay.x, overlay.y, overlay.width, overlay.height])
    : undefined;
  const isDarkAppearance = useColorScheme() === 'dark';
  const hasRootTabs = actions.some(action => action.rootTab);

  if (NativeNavigationGlassSurface) {
    return (
      <NativeNavigationGlassSurface
        geometryLayoutRevision={geometryLayoutRevision}
        actions={actions}
        layoutMode={layoutMode}
        onAction={onAction}
        railBottomInset={railBottomInset}
        railRightInset={railRightInset}
        railTopInset={railTopInset}
        railAvailableHeight={railAvailableHeight}
        style={[styles.surface, hasRootTabs && styles.rootTabSurface, style]}
        testID={testID}
      />
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        isDarkAppearance && styles.darkFallback,
        hasRootTabs && styles.rootTabFallback,
        style,
      ]}
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
    paddingHorizontal: 0,
  },
  rootTabSurface: { height: ROOT_TAB_SURFACE_HEIGHT },
  fallback: {
    backgroundColor: '#ffffff',
    borderRadius: 28,
    paddingBottom: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  rootTabFallback: { paddingBottom: 4, paddingTop: 4 },
  darkFallback: { backgroundColor: '#191f28' },
});
