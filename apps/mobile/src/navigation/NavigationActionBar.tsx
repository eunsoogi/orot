import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';
import { Keyboard, StyleSheet, useColorScheme, View } from 'react-native';
import { navigationText } from '../i18n/navigation';
import {
  NavigationGlassSurface,
  type NavigationGlassSurfaceProps,
} from './NavigationGlassSurface';
import type { NavigationController } from './navigationController';
import { useNavigationSnapshot } from './useNavigationSnapshot';
import {
  createNativeNavigationBindings,
  settleNavigationRequest,
} from './nativeNavigationActions';
import type { NavigationRootTabs } from './rootTabs';
import { NavigationActionButton } from './NavigationActionButton';
import { RootTabActions } from './RootTabActions';
import { NavigationActionBarPresentation } from './NavigationActionBarPresentation';
import type {
  NavigationRouteAction,
  NavigationRouteBackAction,
} from './useNavigationPrimaryAction';

export type NavigationSurfaceProps = NavigationGlassSurfaceProps;
export type NavigationSurface = ComponentType<NavigationSurfaceProps>;

export interface NavigationPrimaryAction {
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly onPress: () => void | Promise<unknown>;
  readonly testID: string;
  readonly systemImageName?: string;
  /** Compact visible title; the accessibility label retains the full action name. */
  readonly navigationLabel?: string;
  /** Explicit priority overrides registration order when a row needs More. */
  readonly navigationPriority?: 'primary' | 'secondary';
  readonly destructive?: boolean;
  readonly disabled?: boolean;
}

export interface NavigationActionBarProps<Name extends string> {
  readonly controller: NavigationController<Name>;
  readonly leaveDisabled?: boolean;
  readonly primaryAction?: NavigationPrimaryAction;
  readonly pageActions?: readonly NavigationRouteAction[];
  readonly routeBackAction?: NavigationRouteBackAction;
  readonly routeKey?: string;
  readonly safeAreaHandledByParent?: boolean;
  readonly keyboardVisible?: boolean;
  // Tests can inject a fallback surface to exercise the non-native controls.
  readonly surface?: NavigationSurface;
  readonly rootTabs?: NavigationRootTabs;
}

/** Keeps contextual actions fixed while root tabs reclaim a keyboard-hidden bottom inset. */
export function NavigationActionBar<Name extends string>({
  controller,
  leaveDisabled = false,
  primaryAction,
  pageActions = [],
  routeBackAction,
  routeKey = snapshotRouteFallback,
  safeAreaHandledByParent = false,
  keyboardVisible,
  surface: Surface = NavigationGlassSurface,
  rootTabs,
}: NavigationActionBarProps<Name>) {
  const snapshot = useNavigationSnapshot(controller);
  const isDarkAppearance = useColorScheme() === 'dark';
  const [systemKeyboardHeight, setSystemKeyboardHeight] = useState(0);
  const isKeyboardVisible = keyboardVisible ?? systemKeyboardHeight > 0;

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', event =>
      setSystemKeyboardHeight(event.endCoordinates.height),
    );
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () =>
      setSystemKeyboardHeight(0),
    );
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const backDisabled = snapshot.isTransitioning || leaveDisabled;
  if (
    !snapshot.canGoBack &&
    !routeBackAction &&
    !primaryAction &&
    !pageActions.length &&
    !rootTabs
  ) {
    return null;
  }

  const nativeBindings = createNativeNavigationBindings({
    controller,
    snapshot,
    backDisabled,
    routeBackAction,
    rootTabs,
  });

  const actions = (
    <View
      style={rootTabs ? styles.rootTabs : styles.actions}
      testID="bottom-navigation-action-bar"
    >
      {/* Keep contextual Back first, ahead of persistent root tabs in the rail. */}
      {routeBackAction || (snapshot.canGoBack && !rootTabs) ? (
        <NavigationActionButton
          accessibilityLabel={navigationText.back.accessibilityLabel}
          disabled={backDisabled}
          isDarkAppearance={isDarkAppearance}
          label={navigationText.back.label}
          onPress={() => {
            if (routeBackAction) {
              settleNavigationRequest(
                Promise.resolve(routeBackAction.onPress()),
              );
            } else {
              settleNavigationRequest(controller.requestBack());
            }
          }}
          testID="navigation-back"
        />
      ) : null}
      {rootTabs ? (
        <RootTabActions
          controller={controller}
          disabled={backDisabled}
          rootTabs={rootTabs}
        />
      ) : null}
    </View>
  );

  const reclaimRootTabInset =
    rootTabs && !isKeyboardVisible && !safeAreaHandledByParent;
  return (
    <NavigationActionBarPresentation
      actions={nativeBindings.actions}
      bottomActions={actions}
      isDarkAppearance={isDarkAppearance}
      keyboardHeight={isKeyboardVisible ? systemKeyboardHeight : 0}
      keyboardVisible={isKeyboardVisible}
      onAction={nativeBindings.onAction}
      primaryAction={primaryAction}
      pageActions={pageActions}
      pageActionsDisabled={snapshot.isTransitioning}
      routeKey={routeKey}
      reclaimRootTabInset={Boolean(reclaimRootTabInset)}
      safeAreaHandledByParent={safeAreaHandledByParent}
      surface={Surface}
    />
  );
}

const snapshotRouteFallback = 'navigation';

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    gap: 8,
  },
  rootTabs: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
});
