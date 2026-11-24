import { useState } from 'react';
import { Platform, useColorScheme, View } from 'react-native';
import { NavigationActionButton } from './NavigationActionButton';
import { navigationText } from '../i18n/navigation';
import {
  NavigationGlassSurface,
  type NavigationGlassAction,
  type NavigationGlassActionEventHandler,
} from './NavigationGlassSurface';
import type {
  NavigationPrimaryAction,
  NavigationSurface,
} from './NavigationActionBar';
import { bottomNavigationMenuStyles as styles } from './bottomNavigationMenuStyles';
import { NavigationActionBarPresentation } from './NavigationActionBarPresentation';
import {
  BOTTOM_NAVIGATION_ROOT_LAYOUT,
  NavigationRootLayoutContext,
} from './navigationRootLayout';

/** Callback routes keep their own stack while sharing the app's bottom actions. */
export function BottomNavigationMenu({
  onBack,
  primaryAction,
  surface: Surface = NavigationGlassSurface,
  testID,
  disabled = false,
}: {
  readonly onBack: () => void | Promise<unknown>;
  readonly primaryAction?: NavigationPrimaryAction;
  readonly surface?: NavigationSurface;
  readonly testID: string;
  readonly disabled?: boolean;
}) {
  const isDarkAppearance = useColorScheme() === 'dark';
  const [contentWidth, setContentWidth] = useState(0);

  const nativeActions: NavigationGlassAction[] = [
    {
      id: 'back',
      label: navigationText.back.label,
      accessibilityLabel: navigationText.back.accessibilityLabel,
      testID,
      systemImageName: 'chevron.backward',
      disabled,
    },
  ];
  if (primaryAction) {
    nativeActions.push({
      id: 'primary',
      label: primaryAction.label,
      accessibilityLabel: primaryAction.accessibilityLabel,
      testID: primaryAction.testID,
      systemImageName: primaryAction.systemImageName ?? 'ellipsis',
      disabled: disabled || primaryAction.disabled === true,
      primary: true,
    });
  }

  const handleNativeAction: NavigationGlassActionEventHandler = ({
    nativeEvent,
  }) => {
    if (disabled) return;
    if (nativeEvent.id === 'back') {
      settleBottomAction(onBack);
      return;
    }
    if (
      nativeEvent.id === 'primary' &&
      primaryAction &&
      !primaryAction.disabled
    ) {
      settleBottomAction(primaryAction.onPress);
    }
  };

  const actions = (
    <View style={styles.actions} testID="bottom-navigation-action-bar">
      <NavigationActionButton
        accessibilityLabel={navigationText.back.accessibilityLabel}
        disabled={disabled}
        isDarkAppearance={isDarkAppearance}
        symbol="chevron.backward"
        onPress={() => settleBottomAction(onBack)}
        testID={testID}
      />
      {primaryAction ? (
        <NavigationActionButton
          accessibilityLabel={primaryAction.accessibilityLabel}
          disabled={disabled || primaryAction.disabled === true}
          isDarkAppearance={isDarkAppearance}
          symbol={primaryAction.systemImageName}
          onPress={() => settleBottomAction(primaryAction.onPress)}
          primary
          testID={primaryAction.testID}
        />
      ) : null}
    </View>
  );
  const surface =
    Platform.OS === 'ios' && Surface === NavigationGlassSurface ? (
      <NavigationRootLayoutContext.Provider
        value={BOTTOM_NAVIGATION_ROOT_LAYOUT}
      >
        <NavigationActionBarPresentation
          actions={nativeActions}
          availableWidthOverride={contentWidth}
          bottomActions={actions}
          isDarkAppearance={isDarkAppearance}
          keyboardHeight={0}
          keyboardVisible={false}
          onAction={handleNativeAction}
          primaryAction={
            primaryAction
              ? {
                  ...primaryAction,
                  disabled: disabled || primaryAction.disabled,
                  onPress: () => settleBottomAction(primaryAction.onPress),
                }
              : undefined
          }
          pageActionsDisabled={disabled}
          reclaimRootTabInset={false}
          safeAreaHandledByParent
          surface={Surface}
        />
      </NavigationRootLayoutContext.Provider>
    ) : (
      <Surface
        actions={nativeActions}
        onAction={handleNativeAction}
        testID={
          Surface === NavigationGlassSurface && Platform.OS === 'ios'
            ? 'navigation-bar-native-surface'
            : 'navigation-bar-fallback'
        }
      >
        {actions}
      </Surface>
    );

  return (
    <View
      testID="bottom-navigation-menu-host"
      style={styles.container}
      onLayout={event =>
        setContentWidth(Math.max(0, event.nativeEvent.layout.width - 40))
      }
    >
      {surface}
    </View>
  );
}

function settleBottomAction(action: () => void | Promise<unknown>): void {
  // Navigation flows own their alerts; handle async failures without leaking rejections.
  const result = action();
  if (result)
    result.then(
      () => undefined,
      () => undefined,
    );
}
