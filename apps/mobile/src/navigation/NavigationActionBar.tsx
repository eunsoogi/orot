import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { appColors } from '../layout/appColors';
import { NAVIGATION_ACTION_VERTICAL_PADDING } from './navigationLayout';

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
  readonly primaryAction?: NavigationPrimaryAction;
  readonly safeAreaHandledByParent?: boolean;
  readonly keyboardVisible?: boolean;
  // Tests can inject a fallback surface to exercise the non-native controls.
  readonly surface?: NavigationSurface;
}

export function NavigationActionBar<Name extends string>({
  controller,
  leaveDisabled = false,
  showHome = false,
  primaryAction,
  safeAreaHandledByParent = false,
  keyboardVisible,
  surface: Surface = NavigationGlassSurface,
}: NavigationActionBarProps<Name>) {
  const snapshot = useNavigationSnapshot(controller);
  const isDarkAppearance = useColorScheme() === 'dark';
  const [systemKeyboardVisible, setSystemKeyboardVisible] = useState(false);
  const isKeyboardVisible = keyboardVisible ?? systemKeyboardVisible;

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () =>
      setSystemKeyboardVisible(true),
    );
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () =>
      setSystemKeyboardVisible(false),
    );
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const backDisabled = snapshot.isTransitioning || leaveDisabled;
  const canGoHome = showHome && snapshot.routes.length > 1;
  if (!snapshot.canGoBack && !canGoHome && !primaryAction) return null;

  const nativeBindings = createNativeNavigationBindings({
    controller,
    snapshot,
    backDisabled,
    canGoHome,
    primaryAction,
  });

  const actions = (
    <View style={styles.actions} testID="bottom-navigation-action-bar">
      {snapshot.canGoBack ? (
        <NavigationActionButton
          accessibilityLabel={navigationText.back.accessibilityLabel}
          disabled={backDisabled}
          isDarkAppearance={isDarkAppearance}
          label={navigationText.back.label}
          onPress={() => settleNavigationRequest(controller.requestBack())}
          testID="navigation-back"
        />
      ) : null}
      {canGoHome ? (
        <NavigationActionButton
          accessibilityLabel={navigationText.home.accessibilityLabel}
          disabled={backDisabled}
          isDarkAppearance={isDarkAppearance}
          label={navigationText.home.label}
          onPress={() => settleNavigationRequest(controller.requestHome())}
          testID="navigation-home"
        />
      ) : null}
      {primaryAction ? (
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

  const surface = (
    <Surface
      actions={nativeBindings.actions}
      onAction={nativeBindings.onAction}
      testID={
        Surface === NavigationGlassSurface && Platform.OS === 'ios'
          ? 'navigation-bar-native-surface'
          : 'navigation-bar-fallback'
      }
    >
      {actions}
    </Surface>
  );

  // Keep the inset here so the overlay reserves the system home area exactly once.
  return safeAreaHandledByParent ? (
    <View pointerEvents="box-none" style={styles.safeArea}>
      {surface}
    </View>
  ) : (
    <SafeAreaView
      edges={isKeyboardVisible ? [] : ['bottom']}
      pointerEvents="box-none"
      style={styles.safeArea}
      testID="navigation-action-bar-safe-area"
    >
      {surface}
    </SafeAreaView>
  );
}

function NavigationActionButton({
  accessibilityLabel,
  disabled,
  isDarkAppearance,
  label,
  onPress,
  primary = false,
  testID,
}: {
  readonly accessibilityLabel: string;
  readonly disabled: boolean;
  readonly isDarkAppearance: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly primary?: boolean;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.action,
        isDarkAppearance && !primary && styles.darkAction,
        primary && styles.primaryAction,
        disabled && styles.disabled,
      ]}
      testID={testID}
    >
      <Text
        style={[
          styles.label,
          isDarkAppearance && !primary && styles.darkLabel,
          primary && styles.primaryLabel,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flexShrink: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 20,
    paddingVertical: NAVIGATION_ACTION_VERTICAL_PADDING,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    gap: 8,
  },
  action: {
    alignItems: 'center',
    borderColor: appColors.border,
    borderRadius: 24,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 50,
    minWidth: 72,
    paddingHorizontal: 8,
  },
  darkAction: { borderColor: '#ffffff' },
  primaryAction: {
    backgroundColor: appColors.primaryAction,
    borderColor: appColors.primaryAction,
  },
  disabled: { opacity: 0.55 },
  label: {
    color: appColors.primaryText,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  darkLabel: { color: '#f7f8fa' },
  primaryLabel: { color: appColors.onPrimary },
});
