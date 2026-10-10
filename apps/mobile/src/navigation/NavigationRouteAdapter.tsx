import type { ReactNode } from 'react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { confirmNavigationLeave } from './navigationLeaveConfirmation';
import { NavigationActionBar } from './NavigationActionBar';
import { NavigationRouteScrollView } from './NavigationRouteScrollView';
import { EdgeSwipeBackRegion } from './EdgeSwipeBackRegion';
import { NavigationLeaveStateRegistrationProvider } from './useNavigationLeaveStateRegistration';
import { createNavigationLeaveGuard } from './navigationLeaveGuard';
import type {
  NavigationController,
  NavigationRoute,
} from './navigationController';
import type { NavigationLeaveGuardOptions } from './navigationLeaveGuard';
import type { NavigationSurface } from './NavigationActionBar';
import type { NavigationPrimaryAction } from './NavigationActionBar';
import { useNavigationSnapshot } from './useNavigationSnapshot';
import type { NavigationRootTabs } from './rootTabs';
import { appColors } from '../layout/appColors';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from './useNavigationPrimaryAction';

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
  'readState' | 'stopRecording'
> &
  Partial<Pick<NavigationLeaveGuardOptions<Name>, 'confirm'>>;

interface RegisteredLeaveState<Name extends string> {
  readonly routeKey: string;
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
}

/** Binds the active app route, its real leave state, and both shared back inputs. */
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
}: NavigationRouteAdapterProps<Name>) {
  const snapshot = useNavigationSnapshot(controller);
  const primary = useNavigationPrimaryActionHost(snapshot.currentRoute.key);
  const [, setLeaveStateVersion] = useState(0);
  const leaveStateRef = useRef(leaveState);
  const registeredLeaveState = useRef<RegisteredLeaveState<Name> | null>(null);
  leaveStateRef.current = leaveState;
  const getLeaveStateSource = useCallback(() => {
    const registration = registeredLeaveState.current;
    return registration?.routeKey === snapshot.currentRoute.key
      ? registration.source
      : leaveStateRef.current;
  }, [snapshot.currentRoute.key]);
  const registerLeaveState = useCallback(
    (source: NavigationLeaveStateSource<Name>) => {
      const registration: RegisteredLeaveState<Name> = {
        routeKey: snapshot.currentRoute.key,
        token: Symbol('navigation-leave-state'),
        source,
      };
      registeredLeaveState.current = registration;
      setLeaveStateVersion(version => version + 1);
      return () => {
        if (registeredLeaveState.current?.token === registration.token) {
          registeredLeaveState.current = null;
          setLeaveStateVersion(version => version + 1);
        }
      };
    },
    [snapshot.currentRoute.key],
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
  const actions = useMemo<NavigationRouteActions<Name>>(
    () => ({
      route: snapshot.currentRoute,
      onBack: controller.requestBack,
      onHome: controller.requestHome,
      push: controller.push,
      replace: controller.replace,
      registerLeaveState,
    }),
    [controller, registerLeaveState, snapshot.currentRoute],
  );
  const leaveDisabled = (() => {
    const source = getLeaveStateSource();
    if (!source) return true;
    try {
      return source.readState().canLeave === false;
    } catch {
      return true;
    }
  })();

  useLayoutEffect(
    () => controller.registerLeaveGuard(snapshot.currentRoute.key, leaveGuard),
    [controller, leaveGuard, snapshot.currentRoute.key],
  );

  const routeContent = (
    <NavigationLeaveStateRegistrationProvider
      registerLeaveState={registerLeaveState}
    >
      <NavigationPrimaryActionContext.Provider value={primary.host}>
        {children(actions)}
      </NavigationPrimaryActionContext.Provider>
    </NavigationLeaveStateRegistrationProvider>
  );
  const routeIsScrollable =
    typeof scrollable === 'function'
      ? scrollable(snapshot.currentRoute)
      : scrollable;
  const routeContentSafeAreaHandledByChild =
    typeof contentSafeAreaHandledByChild === 'function'
      ? contentSafeAreaHandledByChild(snapshot.currentRoute)
      : contentSafeAreaHandledByChild;
  const routeRootTabs =
    typeof rootTabs === 'function' ? rootTabs(snapshot.currentRoute) : rootTabs;
  const body = routeIsScrollable ? (
    <NavigationRouteScrollView>{routeContent}</NavigationRouteScrollView>
  ) : (
    <View style={styles.fill}>{routeContent}</View>
  );
  const gestureRegion = (
    <EdgeSwipeBackRegion controller={controller}>{body}</EdgeSwipeBackRegion>
  );
  const actionBar = (
    <NavigationActionBar
      controller={controller}
      leaveDisabled={leaveDisabled}
      showHome={showHome}
      homeAction={homeAction}
      primaryAction={primary.action ?? primaryAction}
      rootTabs={routeRootTabs}
      surface={surface}
    />
  );

  return (
    <SafeAreaProvider style={styles.fill}>
      {/* Resize the route column so the shared action bar remains above the keyboard. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.fill}
        testID="navigation-keyboard-avoiding-root"
      >
        <View style={styles.fill}>
          {routeContentSafeAreaHandledByChild ? (
            <View style={styles.fill}>{gestureRegion}</View>
          ) : (
            <SafeAreaView
              edges={['top', 'right', 'bottom', 'left']}
              style={styles.fill}
            >
              {gestureRegion}
            </SafeAreaView>
          )}
          {/* The clear native buttons let route content move behind the glass surface. */}
          <View
            pointerEvents="box-none"
            style={styles.actionBarOverlay}
            testID="navigation-action-bar-overlay"
          >
            {actionBar}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: appColors.background },
  actionBarOverlay: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 1,
  },
});
