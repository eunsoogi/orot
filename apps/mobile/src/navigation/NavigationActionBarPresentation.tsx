import { useContext } from 'react';
import type { ReactNode } from 'react';
import {
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NavigationActionButton } from './NavigationActionButton';
import {
  NavigationGlassSurface,
  type NavigationGlassAction,
  type NavigationGlassActionEventHandler,
} from './NavigationGlassSurface';
import type {
  NavigationPrimaryAction,
  NavigationSurface,
} from './NavigationActionBar';
import { settleNavigationRequest } from './nativeNavigationActions';
import {
  NAVIGATION_ACTION_BOTTOM_PADDING,
  NAVIGATION_ACTION_TOP_PADDING,
} from './navigationLayout';
import {
  fitsNavigationRailSegment,
  fitsNavigationRootRail,
  NAVIGATION_CONTEXTUAL_RAIL_CONTROL_HEIGHT,
  NAVIGATION_CONTEXTUAL_RAIL_STACK_SPACING,
  NAVIGATION_ROOT_RAIL_GUTTER,
  NavigationRootLayoutContext,
} from './navigationRootLayout';
import { NavigationSurfacePosition } from './NavigationSurfacePosition';

interface NavigationActionBarPresentationProps {
  readonly actions: readonly NavigationGlassAction[];
  readonly bottomActions: ReactNode;
  readonly isDarkAppearance: boolean;
  readonly keyboardHeight: number;
  readonly keyboardVisible: boolean;
  readonly onAction: NavigationGlassActionEventHandler;
  readonly primaryAction?: NavigationPrimaryAction;
  readonly reclaimRootTabInset: boolean;
  readonly safeAreaHandledByParent: boolean;
  readonly surface: NavigationSurface;
}

/** Keeps one native host mounted while the content lane, rail, and bottom action change size. */
export function NavigationActionBarPresentation({
  actions,
  bottomActions,
  isDarkAppearance,
  keyboardHeight,
  keyboardVisible,
  onAction,
  primaryAction,
  reclaimRootTabInset,
  safeAreaHandledByParent,
  surface: Surface = NavigationGlassSurface,
}: NavigationActionBarPresentationProps) {
  const layout = useContext(NavigationRootLayoutContext);
  const candidateRightLayout =
    layout.placement === 'right' ? layout : undefined;
  const candidateRailHeight = candidateRightLayout
    ? Math.max(0, candidateRightLayout.windowHeight - keyboardHeight)
    : 0;
  const candidateRailBottomInset =
    candidateRightLayout && keyboardHeight > 0
      ? NAVIGATION_ROOT_RAIL_GUTTER
      : candidateRightLayout?.railBottomInset;
  const hasRootTabs = actions.some(action => action.rootTab);
  const contextualActionCount = actions.filter(
    action => action.id !== 'primary',
  ).length;
  // Native inner actions keep one flexible spacer, so each control also needs
  // one stack gap.
  // Keyboard resizing can remove room for either native stack. Move controls
  // to bottom flow rather than clipping them.
  const railFits = candidateRightLayout
    ? hasRootTabs
      ? fitsNavigationRootRail(
          candidateRailHeight,
          candidateRightLayout.railTopInset,
          candidateRailBottomInset ?? 0,
        )
      : fitsNavigationRailSegment(
          candidateRailHeight,
          candidateRightLayout.railTopInset,
          candidateRailBottomInset ?? 0,
          contextualActionCount *
            (NAVIGATION_CONTEXTUAL_RAIL_CONTROL_HEIGHT +
              NAVIGATION_CONTEXTUAL_RAIL_STACK_SPACING),
        )
    : false;
  const rightLayout = railFits ? candidateRightLayout : undefined;
  const isRightRail = rightLayout !== undefined;
  const laneActions = rightLayout
    ? actions.filter(action => action.id !== 'primary')
    : actions;
  const railHeight = isRightRail ? candidateRailHeight : 0;
  const railBottomInset = isRightRail ? candidateRailBottomInset : undefined;
  const railFrameStyle = rightLayout
    ? {
        bottom: 0,
        height: railHeight,
        position: 'absolute' as const,
        right: 0,
        width: rightLayout.reservedRightWidth,
      }
    : undefined;
  const primaryActions = primaryAction ? (
    <View style={styles.actions} testID="navigation-primary-action-bar">
      <NavigationActionButton
        accessibilityLabel={primaryAction.accessibilityLabel}
        disabled={
          actions.find(action => action.id === 'primary')?.disabled === true
        }
        isDarkAppearance={isDarkAppearance}
        label={primaryAction.label}
        onPress={() =>
          settleNavigationRequest(Promise.resolve(primaryAction.onPress()))
        }
        primary
        testID={primaryAction.testID}
      />
    </View>
  ) : null;
  const surfaceTestID =
    Surface === NavigationGlassSurface && Platform.OS === 'ios'
      ? 'navigation-bar-native-surface'
      : 'navigation-bar-fallback';
  const railProps = rightLayout
    ? {
        layoutMode: 'right' as const,
        railBottomInset,
        railRightInset: rightLayout.railRightInset,
        railTopInset: rightLayout.railTopInset,
      }
    : { layoutMode: 'bottom' as const };
  const nativeSurfaceStyle: StyleProp<ViewStyle> = isRightRail
    ? styles.railSurface
    : undefined;
  const hostStyle: StyleProp<ViewStyle> = isRightRail
    ? [styles.railHost, railFrameStyle]
    : styles.safeArea;
  const surfacePosition = (
    <NavigationSurfacePosition
      reclaimRootTabInset={reclaimRootTabInset && !isRightRail}
      style={isRightRail ? styles.fill : undefined}
    >
      <Surface
        actions={laneActions}
        onAction={onAction}
        testID={isRightRail ? 'navigation-right-rail' : surfaceTestID}
        style={nativeSurfaceStyle}
        {...railProps}
      >
        {isRightRail ? null : bottomActions}
      </Surface>
    </NavigationSurfacePosition>
  );
  const bottomSurface = safeAreaHandledByParent ? (
    <View
      pointerEvents="box-none"
      style={hostStyle}
      testID={isRightRail ? 'navigation-right-rail-host' : undefined}
    >
      {surfacePosition}
    </View>
  ) : (
    <SafeAreaView
      edges={isRightRail || keyboardVisible ? [] : ['bottom']}
      pointerEvents="box-none"
      style={hostStyle}
      testID={
        isRightRail
          ? 'navigation-right-rail-host'
          : 'navigation-action-bar-safe-area'
      }
    >
      {surfacePosition}
    </SafeAreaView>
  );
  const primarySurface =
    rightLayout && primaryAction ? (
      <SafeAreaView
        edges={safeAreaHandledByParent || keyboardVisible ? [] : ['bottom']}
        pointerEvents="box-none"
        style={[styles.safeArea, { width: rightLayout.contentWidth }]}
      >
        <Surface
          actions={actions.filter(action => action.id === 'primary')}
          layoutMode="bottom"
          onAction={onAction}
          style={styles.primarySurface}
          testID="navigation-primary-action-surface"
        >
          {primaryActions}
        </Surface>
      </SafeAreaView>
    ) : null;

  return (
    <View pointerEvents="box-none" style={styles.host}>
      {bottomSurface}
      {primarySurface}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  host: { position: 'relative' },
  safeArea: {
    flexShrink: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 8,
    paddingTop: NAVIGATION_ACTION_TOP_PADDING,
    paddingBottom: NAVIGATION_ACTION_BOTTOM_PADDING,
  },
  railHost: {
    overflow: 'visible',
    padding: 0,
  },
  railSurface: {
    height: '100%',
    width: '100%',
  },
  primarySurface: {
    width: '100%',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    gap: 8,
  },
});
