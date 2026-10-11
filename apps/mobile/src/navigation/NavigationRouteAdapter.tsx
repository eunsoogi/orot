import type { ReactNode } from 'react';
import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationViewport } from './NavigationViewport';
import { NavigationActionBar } from './NavigationActionBar';
import type {
  NavigationController,
  NavigationRoute,
} from './navigationController';
import type { NavigationLeaveGuardOptions } from './navigationLeaveGuard';
import type { NavigationSurface } from './NavigationActionBar';
import type { NavigationPrimaryAction } from './NavigationActionBar';
import type { NavigationRootTabs } from './rootTabs';
import { useNavigationSnapshot } from './useNavigationSnapshot';
import { useNavigationPrimaryActionHost } from './useNavigationPrimaryAction';
import { NativeRouteStack } from './NativeRouteStack';
import { NavigationRouteScene } from './NavigationRouteScene';
import { appColors } from '../layout/appColors';

export interface NavigationRouteActions<Name extends string> {
  readonly route: NavigationRoute<Name>;
  readonly onBack: () => Promise<boolean>;
  readonly onHome: () => Promise<boolean>;
  readonly push: (name: Name) => NavigationRoute<Name> | null;
  readonly replace: (name: Name) => NavigationRoute<Name> | null;
  readonly registerLeaveState: (
    source: NavigationLeaveStateSource<Name>,
  ) => () => void;
}

export type NavigationLeaveStateSource<Name extends string> = Pick<
  NavigationLeaveGuardOptions<Name>,
  'readState'
> &
  Partial<Pick<NavigationLeaveGuardOptions<Name>, 'confirm' | 'stopRecording'>>;

interface RegisteredLeaveState<Name extends string> {
  readonly token: symbol;
  readonly source: NavigationLeaveStateSource<Name>;
}

export interface NavigationRouteAdapterProps<Name extends string> {
  readonly controller: NavigationController<Name>;
  readonly leaveState?: NavigationLeaveStateSource<Name>;
  readonly children: (actions: NavigationRouteActions<Name>) => ReactNode;
  readonly scrollable?: boolean | ((route: NavigationRoute<Name>) => boolean);
  readonly showHome?: boolean;
  readonly homeAction?: () => void | Promise<unknown>;
  readonly primaryAction?: NavigationPrimaryAction;
  readonly contentSafeAreaHandledByChild?:
    boolean | ((route: NavigationRoute<Name>) => boolean);
  readonly surface?: NavigationSurface;
  readonly rootTabs?:
    | NavigationRootTabs
    | ((route: NavigationRoute<Name>) => NavigationRootTabs | undefined);
  readonly onNativeRouteRemovalComplete?: (routeKey: string) => void;
}

/** Binds route-local guards and shared actions to UIKit's native navigation stack. */
export function NavigationRouteAdapter<Name extends string>({
  controller,
  leaveState,
  children,
  scrollable = false,
  showHome = false,
  homeAction,
  primaryAction,
  contentSafeAreaHandledByChild = false,
  surface,
  rootTabs,
  onNativeRouteRemovalComplete,
}: NavigationRouteAdapterProps<Name>) {
  const snapshot = useNavigationSnapshot(controller);
  const primary = useNavigationPrimaryActionHost(snapshot.currentRoute.key);
  const [, setLeaveStateVersion] = useState(0);
  const leaveStateRef = useRef(leaveState);
  const registeredLeaveStates = useRef(
    new Map<string, RegisteredLeaveState<Name>>(),
  );
  leaveStateRef.current = leaveState;

  const getLeaveStateSource = useCallback((routeKey: string) => {
    return (
      registeredLeaveStates.current.get(routeKey)?.source ??
      leaveStateRef.current
    );
  }, []);
  const registerLeaveState = useCallback(
    (routeKey: string, source: NavigationLeaveStateSource<Name>) => {
      const registration = { token: Symbol('navigation-leave-state'), source };
      registeredLeaveStates.current.set(routeKey, registration);
      setLeaveStateVersion(version => version + 1);
      return () => {
        if (
          registeredLeaveStates.current.get(routeKey)?.token !==
          registration.token
        ) {
          return;
        }
        registeredLeaveStates.current.delete(routeKey);
        setLeaveStateVersion(version => version + 1);
      };
    },
    [],
  );

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

      return (
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
        >
          {children}
        </NavigationRouteScene>
      );
    },
    [
      children,
      contentSafeAreaHandledByChild,
      controller,
      getLeaveStateSource,
      primary.host,
      registerLeaveState,
      rootTabs,
      scrollable,
      snapshot.currentRoute.key,
    ],
  );
  const routeRootTabs =
    typeof rootTabs === 'function' ? rootTabs(snapshot.currentRoute) : rootTabs;
  const actionBar = (
    <NavigationActionBar
      controller={controller}
      leaveDisabled={activeLeaveDisabled}
      showHome={showHome}
      homeAction={homeAction}
      primaryAction={primary.action ?? primaryAction}
      rootTabs={routeRootTabs}
      surface={surface}
    />
  );

  return (
    <SafeAreaProvider style={styles.fill}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.fill}
        testID="navigation-keyboard-avoiding-root"
      >
        <NavigationViewport actionBar={actionBar} childHandlesSafeArea>
          <NativeRouteStack
            controller={controller}
            isTransitioning={snapshot.isTransitioning}
            renderRoute={renderRoute}
            routes={snapshot.routes}
            onNativeRouteRemovalComplete={onNativeRouteRemovalComplete}
          />
        </NavigationViewport>
      </KeyboardAvoidingView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: appColors.background },
});
