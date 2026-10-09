import type { ComponentType, ReactNode } from 'react';
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
import { NavigationGlassSurface } from './NavigationGlassSurface';
import type { NavigationController } from './navigationController';
import { useNavigationSnapshot } from './useNavigationSnapshot';

export interface NavigationSurfaceProps {
  readonly children: ReactNode;
  readonly testID: string;
}

export type NavigationSurface = ComponentType<NavigationSurfaceProps>;

function settleNavigationRequest(request: Promise<boolean>) {
  request.then(
    () => undefined,
    () => undefined,
  );
}

export interface NavigationActionBarProps<Name extends string> {
  readonly controller: NavigationController<Name>;
  readonly leaveDisabled?: boolean;
  readonly showHome?: boolean;
  readonly safeAreaHandledByParent?: boolean;
  readonly keyboardVisible?: boolean;
  // A native glass surface can be supplied after its platform bridge is registered.
  readonly surface?: NavigationSurface;
}

export function NavigationActionBar<Name extends string>({
  controller,
  leaveDisabled = false,
  showHome = false,
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
  if (!snapshot.canGoBack && !canGoHome) return null;

  const actions = (
    <View style={styles.actions} testID="bottom-navigation-action-bar">
      {snapshot.canGoBack ? (
        <Pressable
          accessibilityLabel={navigationText.back.accessibilityLabel}
          accessibilityRole="button"
          disabled={backDisabled}
          onPress={() => {
            settleNavigationRequest(controller.requestBack());
          }}
          style={[
            styles.action,
            isDarkAppearance && styles.darkAction,
            backDisabled && styles.disabled,
          ]}
          testID="navigation-back"
        >
          <Text style={[styles.label, isDarkAppearance && styles.darkLabel]}>
            {navigationText.back.label}
          </Text>
        </Pressable>
      ) : null}
      {canGoHome ? (
        <Pressable
          accessibilityLabel={navigationText.home.accessibilityLabel}
          accessibilityRole="button"
          disabled={backDisabled}
          onPress={() => {
            settleNavigationRequest(controller.requestHome());
          }}
          style={[
            styles.action,
            isDarkAppearance && styles.darkAction,
            backDisabled && styles.disabled,
          ]}
          testID="navigation-home"
        >
          <Text style={[styles.label, isDarkAppearance && styles.darkLabel]}>
            {navigationText.home.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  const surface = (
    <Surface
      testID={
        Surface === NavigationGlassSurface && Platform.OS === 'ios'
          ? 'navigation-bar-native-surface'
          : 'navigation-bar-fallback'
      }
    >
      {actions}
    </Surface>
  );

  // Keep the bar in normal layout flow beside the screen scroller, never over its last row.
  return safeAreaHandledByParent ? (
    <View style={styles.safeArea}>{surface}</View>
  ) : (
    <SafeAreaView
      edges={isKeyboardVisible ? [] : ['bottom']}
      style={styles.safeArea}
      testID="navigation-action-bar-safe-area"
    >
      {surface}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flexShrink: 0 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  action: {
    alignItems: 'center',
    borderColor: '#34434e',
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 88,
    paddingHorizontal: 16,
  },
  darkAction: { borderColor: '#f7f8fa' },
  disabled: { opacity: 0.55 },
  label: {
    color: '#12212b',
    fontSize: 16,
    fontWeight: '600',
  },
  darkLabel: { color: '#f7f8fa' },
});
