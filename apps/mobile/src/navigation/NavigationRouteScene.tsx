import { useCallback, useLayoutEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NavigationRouteScrollView } from './NavigationRouteScrollView';
import {
  NavigationPrimaryActionContext,
  type NavigationPrimaryActionHost,
} from './useNavigationPrimaryAction';
import { NavigationLeaveStateRegistrationProvider } from './useNavigationLeaveStateRegistration';
import { createNavigationLeaveGuard } from './navigationLeaveGuard';
import { confirmNavigationLeave } from './navigationLeaveConfirmation';
import type {
  NavigationController,
  NavigationRoute,
} from './navigationController';
import type {
  NavigationLeaveStateSource,
  NavigationRouteActions,
} from './NavigationRouteAdapter';
import type { NavigationRootTabs } from './rootTabs';

export interface NavigationRouteSceneProps<Name extends string> {
  readonly route: NavigationRoute<Name>;
  readonly controller: NavigationController<Name>;
  readonly active: boolean;
  readonly scrollable: boolean;
  readonly childHandlesSafeArea: boolean;
  readonly rootTabs?: NavigationRootTabs;
  readonly primaryActionHost: NavigationPrimaryActionHost | null;
  readonly registerLeaveStateForRoute: (
    routeKey: string,
    source: NavigationLeaveStateSource<Name>,
  ) => () => void;
  readonly getLeaveStateSource: () =>
    NavigationLeaveStateSource<Name> | undefined;
  readonly children: (actions: NavigationRouteActions<Name>) => ReactNode;
}

/** Binds a retained native route to its own draft state and guarded actions. */
export function NavigationRouteScene<Name extends string>({
  route,
  controller,
  active,
  scrollable,
  childHandlesSafeArea,
  rootTabs,
  primaryActionHost,
  registerLeaveStateForRoute,
  getLeaveStateSource,
  children,
}: NavigationRouteSceneProps<Name>) {
  // Preserve source identity while an async leave confirmation checks for stale state.
  const registerLeaveState = useCallback(
    (source: NavigationLeaveStateSource<Name>) =>
      registerLeaveStateForRoute(route.key, source),
    [registerLeaveStateForRoute, route.key],
  );
  const actions = useMemo<NavigationRouteActions<Name>>(
    () => ({
      route,
      onBack: controller.requestBack,
      onHome: controller.requestHome,
      push: controller.push,
      replace: controller.replace,
      registerLeaveState,
    }),
    [controller, registerLeaveState, route],
  );
  const leaveGuard = useMemo(
    () =>
      createNavigationLeaveGuard<Name>({
        readState: () => {
          const source = getLeaveStateSource();
          if (!source) {
            throw new Error('The active route has no leave-state owner.');
          }
          return source.readState();
        },
        confirm: async request => {
          const source = getLeaveStateSource();
          if (!source) return false;
          const approved = await (source.confirm ?? confirmNavigationLeave)(
            request,
          );
          return approved && getLeaveStateSource() === source;
        },
        stopRecording: async () => {
          const source = getLeaveStateSource();
          if (!source?.stopRecording) {
            throw new Error('The active route cannot stop its recording.');
          }
          await source.stopRecording();
        },
      }),
    [getLeaveStateSource],
  );

  useLayoutEffect(
    () => controller.registerLeaveGuard(route.key, leaveGuard),
    [controller, leaveGuard, route.key],
  );

  const routeContent = (
    <NavigationLeaveStateRegistrationProvider
      registerLeaveState={registerLeaveState}
    >
      <NavigationPrimaryActionContext.Provider
        value={active ? primaryActionHost : null}
      >
        {children(actions)}
      </NavigationPrimaryActionContext.Provider>
    </NavigationLeaveStateRegistrationProvider>
  );
  const body = scrollable ? (
    <NavigationRouteScrollView
      key={`${route.key}:${rootTabs?.activeTab ?? ''}`}
    >
      {routeContent}
    </NavigationRouteScrollView>
  ) : (
    <View style={styles.fill}>{routeContent}</View>
  );

  return (
    <View style={styles.fill} testID={`navigation-route-scene-${route.key}`}>
      {childHandlesSafeArea ? (
        body
      ) : (
        <SafeAreaView edges={['top', 'right', 'left']} style={styles.fill}>
          {body}
        </SafeAreaView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
