import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationViewport } from './NavigationViewport';
import { NavigationActionBar } from './NavigationActionBar';
import type {
  NavigationController,
  NavigationRoute,
} from './navigationController';
import type {
  NavigationLeaveStateSource,
  NavigationRouteActions,
} from './navigationRouteContracts';
export type {
  NavigationLeaveStateSource,
  NavigationRouteActions,
} from './navigationRouteContracts';
import type { NavigationSurface } from './NavigationActionBar';
import type { NavigationPrimaryAction } from './NavigationActionBar';
import type { NavigationRootTabs } from './rootTabs';
import { useNavigationSnapshot } from './useNavigationSnapshot';
import { useNavigationEntryAvailability } from './useNavigationEntryAvailability';
import { useRegisteredLeaveStates } from './useRegisteredLeaveStates';
import { useNavigationPrimaryActionHost } from './useNavigationPrimaryAction';
import { NativeRouteStack } from './NativeRouteStack';
import { NavigationRouteScene } from './NavigationRouteScene';
import { navigationRouteAdapterStyles as styles } from './navigationRouteAdapterStyles';
import { observeNavigationTest } from './navigationTestObservation';
import { NavigationGeometryProvider } from './NavigationGeometryProvider';
import {
  NavigationMotionContext,
  useNavigationReduceMotion,
} from './NavigationMotionContext';
import type { NavigationRouteLayoutPolicy } from './appContentLayoutPolicy';

export interface NavigationRouteAdapterProps<Name extends string> {
  readonly controller: NavigationController<Name>;
  readonly leaveState?: NavigationLeaveStateSource<Name>;
  readonly children: (actions: NavigationRouteActions<Name>) => ReactNode;
  readonly scrollable?: boolean | ((route: NavigationRoute<Name>) => boolean);
  readonly primaryAction?: NavigationPrimaryAction;
  readonly contentSafeAreaHandledByChild?:
    boolean | ((route: NavigationRoute<Name>) => boolean);
  readonly contentLayoutOwner?: NavigationRouteLayoutPolicy<Name>;
  readonly surface?: NavigationSurface;
  readonly rootTabs?:
    | NavigationRootTabs
    | ((route: NavigationRoute<Name>) => NavigationRootTabs | undefined);
  readonly onNativeRouteRemovalComplete?: (routeKey: string) => void;
}
/** Shares route guards and Reduce Motion state with the native stack and action bar. */
export function NavigationRouteAdapter<Name extends string>({
  controller,
  leaveState,
  children,
  scrollable = false,
  primaryAction,
  contentSafeAreaHandledByChild = false,
  contentLayoutOwner = 'scene',
  surface,
  rootTabs,
  onNativeRouteRemovalComplete,
}: NavigationRouteAdapterProps<Name>) {
  const snapshot = useNavigationSnapshot(controller);
  const reduceMotion = useNavigationReduceMotion();
  const primary = useNavigationPrimaryActionHost(snapshot.currentRoute.key);
  const { getLeaveStateSource, registerLeaveState } = useRegisteredLeaveStates(
    controller,
    leaveState,
  );
  useNavigationEntryAvailability(
    controller,
    snapshot.currentRoute.key,
    getLeaveStateSource,
  );
  const canNativeGoBack = (routeKey: string) => {
    if (snapshot.isTransitioning) {
      observeNavigationTest('native-guard-transitioning', { routeKey });
      return false;
    }
    try {
      const state = getLeaveStateSource(routeKey)?.readState();
      observeNavigationTest('native-guard-state', {
        routeKey,
        hasState: !!state,
        canLeave: state?.canLeave !== false,
        dirty: !!state?.hasUnsavedChanges,
        recording: !!state?.isRecording,
        ongoing: !!state?.hasOngoingOperation,
      });
      return (
        !!state &&
        state.canLeave !== false &&
        !state.hasUnsavedChanges &&
        !state.isRecording &&
        !state.hasOngoingOperation
      );
    } catch {
      observeNavigationTest('native-guard-read-failed', { routeKey });
      return false;
    }
  };
  const activeLeaveDisabled = (() => {
    const source = getLeaveStateSource(snapshot.currentRoute.key);
    if (snapshot.isTransitioning || !source) return true;
    try {
      return source.readState().canLeave === false;
    } catch {
      return true;
    }
  })();
  const renderRoute = useCallback(
    (route: NavigationRoute<Name>) => {
      const active = route.key === snapshot.currentRoute.key;
      const routeIsScrollable =
        typeof scrollable === 'function' ? scrollable(route) : scrollable;
      const routeHandlesSafeArea =
        typeof contentSafeAreaHandledByChild === 'function'
          ? contentSafeAreaHandledByChild(route)
          : contentSafeAreaHandledByChild;
      const routeRootTabs =
        typeof rootTabs === 'function' ? rootTabs(route) : rootTabs;
      const layoutOwner =
        typeof contentLayoutOwner === 'function'
          ? contentLayoutOwner(route, routeRootTabs)
          : contentLayoutOwner;
      // Keep the rail inside its native route while the stack spans the window;
      // retained routes cannot publish or receive input from an inactive rail.
      return (
        <NavigationViewport
          active={active}
          childHandlesSafeArea
          actionBar={
            active ? (
              <NavigationActionBar
                controller={controller}
                leaveDisabled={activeLeaveDisabled}
                pageActions={primary.actions}
                primaryAction={
                  primary.actions.length ? undefined : primaryAction
                }
                routeKey={route.key}
                rootTabs={routeRootTabs}
                surface={surface}
              />
            ) : null
          }
        >
          <NavigationRouteScene
            active={active}
            childHandlesSafeArea={routeHandlesSafeArea}
            controller={controller}
            getLeaveStateSource={() => getLeaveStateSource(route.key)}
            key={route.key}
            primaryActionHost={primary.host}
            registerLeaveStateForRoute={registerLeaveState}
            rootTabs={routeRootTabs}
            route={route}
            scrollable={routeIsScrollable}
            contentLayoutOwner={layoutOwner}
          >
            {children}
          </NavigationRouteScene>
        </NavigationViewport>
      );
    },
    [
      children,
      contentSafeAreaHandledByChild,
      contentLayoutOwner,
      controller,
      getLeaveStateSource,
      primary.host,
      primary.actions,
      registerLeaveState,
      rootTabs,
      scrollable,
      snapshot.currentRoute.key,
      activeLeaveDisabled,
      primaryAction,
      surface,
    ],
  );
  return (
    <NavigationMotionContext.Provider value={reduceMotion}>
      <SafeAreaProvider style={styles.fill}>
        <NavigationGeometryProvider>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.fill}
            testID="navigation-keyboard-avoiding-root"
          >
            <NativeRouteStack
              controller={controller}
              canNativeGoBack={canNativeGoBack}
              isTransitioning={snapshot.isTransitioning}
              reduceMotion={reduceMotion}
              renderRoute={renderRoute}
              routes={snapshot.routes}
              onNativeRouteRemovalComplete={onNativeRouteRemovalComplete}
            />
          </KeyboardAvoidingView>
        </NavigationGeometryProvider>
      </SafeAreaProvider>
    </NavigationMotionContext.Provider>
  );
}
