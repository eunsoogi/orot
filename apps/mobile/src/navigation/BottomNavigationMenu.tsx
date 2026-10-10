import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { navigationText } from '../i18n/navigation';
import { appColors } from '../layout/appColors';
import {
  NAVIGATION_ACTION_TOP_PADDING,
  NAVIGATION_ACTION_BOTTOM_PADDING,
} from './navigationLayout';
import {
  NavigationGlassSurface,
  type NavigationGlassAction,
  type NavigationGlassActionEventHandler,
} from './NavigationGlassSurface';
import type {
  NavigationPrimaryAction,
  NavigationSurface,
} from './NavigationActionBar';

/** Callback routes keep their own stack while sharing the app's bottom actions. */
export function BottomNavigationMenu({
  onBack,
  onHome,
  primaryAction,
  surface: Surface = NavigationGlassSurface,
  testID,
  disabled = false,
}: {
  readonly onBack: () => void | Promise<unknown>;
  readonly onHome?: () => void | Promise<unknown>;
  readonly primaryAction?: NavigationPrimaryAction;
  readonly surface?: NavigationSurface;
  readonly testID: string;
  readonly disabled?: boolean;
}) {
  const isDarkAppearance = useColorScheme() === 'dark';

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
  if (onHome) {
    nativeActions.push({
      id: 'home',
      label: navigationText.home.label,
      accessibilityLabel: navigationText.home.accessibilityLabel,
      testID: 'navigation-home',
      systemImageName: 'house',
      disabled,
    });
  }
  if (primaryAction) {
    nativeActions.push({
      id: 'primary',
      label: primaryAction.label,
      accessibilityLabel: primaryAction.accessibilityLabel,
      testID: primaryAction.testID,
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
    if (nativeEvent.id === 'home' && onHome) {
      settleBottomAction(onHome);
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
      <BottomAction
        accessibilityLabel={navigationText.back.accessibilityLabel}
        disabled={disabled}
        isDarkAppearance={isDarkAppearance}
        label={navigationText.back.label}
        onPress={onBack}
        testID={testID}
      />
      {onHome ? (
        <BottomAction
          accessibilityLabel={navigationText.home.accessibilityLabel}
          disabled={disabled}
          isDarkAppearance={isDarkAppearance}
          label={navigationText.home.label}
          onPress={onHome}
          testID="navigation-home"
        />
      ) : null}
      {primaryAction ? (
        <BottomAction
          accessibilityLabel={primaryAction.accessibilityLabel}
          disabled={disabled || primaryAction.disabled === true}
          isDarkAppearance={isDarkAppearance}
          label={primaryAction.label}
          onPress={primaryAction.onPress}
          primary
          testID={primaryAction.testID}
        />
      ) : null}
    </View>
  );
  const surface = (
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

  return <View style={styles.container}>{surface}</View>;
}

function BottomAction({
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
  readonly onPress: () => void | Promise<unknown>;
  readonly primary?: boolean;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => settleBottomAction(onPress)}
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

function settleBottomAction(action: () => void | Promise<unknown>): void {
  // Navigation flows own their alerts; handle async failures without leaking rejections.
  const result = action();
  if (result)
    result.then(
      () => undefined,
      () => undefined,
    );
}

const styles = StyleSheet.create({
  container: {
    flexShrink: 0,
    paddingHorizontal: 20,
    paddingTop: NAVIGATION_ACTION_TOP_PADDING,
    paddingBottom: NAVIGATION_ACTION_BOTTOM_PADDING,
  },
  actions: { flexDirection: 'row', gap: 8 },
  action: {
    flex: 1,
    alignItems: 'center',
    borderColor: appColors.border,
    justifyContent: 'center',
    borderWidth: 1,
    minHeight: 50,
    minWidth: 72,
    borderRadius: 24,
    paddingHorizontal: 8,
  },
  darkAction: { borderColor: '#ffffff' },
  primaryAction: {
    backgroundColor: appColors.primaryAction,
    borderColor: appColors.primaryAction,
  },
  label: { color: appColors.primaryText, fontSize: 15, fontWeight: '600' },
  darkLabel: { color: '#ffffff' },
  primaryLabel: { color: appColors.onPrimary },
  disabled: { opacity: 0.5 },
});
