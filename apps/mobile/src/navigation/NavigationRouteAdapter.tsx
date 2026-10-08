import type { ReactNode } from 'react';
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { confirmNavigationLeave } from './navigationLeaveConfirmation';
import { NavigationActionBar } from './NavigationActionBar';
import { EdgeSwipeBackRegion } from './EdgeSwipeBackRegion';
import { createNavigationLeaveGuard } from './navigationLeaveGuard';
import type {
  NavigationController,
  NavigationRoute,
} from './navigationController';
import type { NavigationLeaveGuardOptions } from './navigationLeaveGuard';
import type { NavigationSurface } from './NavigationActionBar';
import { useNavigationSnapshot } from './useNavigationSnapshot';

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
  readonly contentSafeAreaHandledByChild?:
    boolean | ((route: NavigationRoute<Name>) => boolean);
  readonly surface?: NavigationSurface;
}

/** Binds the active app route, its real leave state, and both shared back inputs. */
export function NavigationRouteAdapter<Name extends string>({
  controller,
  leaveState,
  children,
  scrollable = false,
  showHome = false,
  contentSafeAreaHandledByChild = false,
  surface,
}: NavigationRouteAdapterProps<Name>) {
  const snapshot = useNavigationSnapshot(controller);
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
      return () => {
        if (registeredLeaveState.current?.token === registration.token) {
          registeredLeaveState.current = null;
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

  useLayoutEffect(
    () => controller.registerLeaveGuard(snapshot.currentRoute.key, leaveGuard),
    [controller, leaveGuard, snapshot.currentRoute.key],
  );

  const routeContent = children(actions);
  const routeIsScrollable =
    typeof scrollable === 'function'
      ? scrollable(snapshot.currentRoute)
      : scrollable;
  const routeContentSafeAreaHandledByChild =
    typeof contentSafeAreaHandledByChild === 'function'
      ? contentSafeAreaHandledByChild(snapshot.currentRoute)
      : contentSafeAreaHandledByChild;
  const body = routeIsScrollable ? (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      style={styles.fill}
      testID="navigation-route-scroll"
    >
      {routeContent}
    </ScrollView>
  ) : (
    <View style={styles.fill}>{routeContent}</View>
  );
  const gestureRegion = (
    <EdgeSwipeBackRegion controller={controller}>{body}</EdgeSwipeBackRegion>
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
            <SafeAreaView edges={['top', 'right', 'left']} style={styles.fill}>
              {gestureRegion}
            </SafeAreaView>
          )}
          <NavigationActionBar
            controller={controller}
            showHome={showHome}
            surface={surface}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrollContent: { flexGrow: 1 },
});
