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

export type NavigationSurfaceProps = NavigationGlassSurfaceProps;
export type NavigationSurface = ComponentType<NavigationSurfaceProps>;

export interface NavigationPrimaryAction {
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly onPress: () => void | Promise<unknown>;
  readonly testID: string;
  readonly disabled?: boolean;
}

export interface NavigationActionBarProps<Name extends string> {
  readonly controller: NavigationController<Name>;
  readonly leaveDisabled?: boolean;
  readonly showHome?: boolean;
  readonly homeAction?: () => void | Promise<unknown>;
  readonly primaryAction?: NavigationPrimaryAction;
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
  showHome = false,
  homeAction,
  primaryAction,
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
  const canGoHome = showHome && snapshot.routes.length > 1;
  if (!snapshot.canGoBack && !canGoHome && !primaryAction && !rootTabs) {
    return null;
  }

  const nativeBindings = createNativeNavigationBindings({
    controller,
    snapshot,
    backDisabled,
    canGoHome,
    homeAction,
    primaryAction,
    rootTabs,
  });

  const actions = (
    <View
      style={rootTabs ? styles.rootTabs : styles.actions}
      testID="bottom-navigation-action-bar"
    >
      {rootTabs ? (
        <RootTabActions
          controller={controller}
          disabled={backDisabled}
          rootTabs={rootTabs}
        />
      ) : null}
      {snapshot.canGoBack && !rootTabs ? (
        <NavigationActionButton
          accessibilityLabel={navigationText.back.accessibilityLabel}
          disabled={backDisabled}
          isDarkAppearance={isDarkAppearance}
          label={navigationText.back.label}
          onPress={() => settleNavigationRequest(controller.requestBack())}
          testID="navigation-back"
        />
      ) : null}
      {canGoHome && !rootTabs ? (
        <NavigationActionButton
          accessibilityLabel={navigationText.home.accessibilityLabel}
          disabled={backDisabled}
          isDarkAppearance={isDarkAppearance}
          label={navigationText.home.label}
          onPress={() =>
            settleNavigationRequest(
              Promise.resolve(homeAction?.() ?? controller.requestHome()),
            )
          }
          testID="navigation-home"
        />
      ) : null}
      {primaryAction && !rootTabs ? (
        <NavigationActionButton
          accessibilityLabel={primaryAction.accessibilityLabel}
          disabled={backDisabled || primaryAction.disabled === true}
          isDarkAppearance={isDarkAppearance}
          label={primaryAction.label}
          onPress={() =>
            settleNavigationRequest(Promise.resolve(primaryAction.onPress()))
          }
          primary
          testID={primaryAction.testID}
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
      reclaimRootTabInset={Boolean(reclaimRootTabInset)}
      safeAreaHandledByParent={safeAreaHandledByParent}
      surface={Surface}
    />
  );
}

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
