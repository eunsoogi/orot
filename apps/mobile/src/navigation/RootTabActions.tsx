import { useContext, useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import type { NavigationController } from './navigationController';
import type { NavigationRootTabs } from './rootTabs';
import { rootTabItems } from './rootTabs';
import { appColorPalettes, appColors } from '../layout/appColors';
import { settleNavigationRequest } from './nativeNavigationActions';
import { NavigationMotionContext } from './NavigationMotionContext';
import { ROOT_TAB_TOUCH_TARGET_HEIGHT } from './navigationLayout';

interface RootTabActionsProps<Name extends string> {
  readonly controller: NavigationController<Name>;
  readonly disabled: boolean;
  readonly rootTabs: NavigationRootTabs;
}

/** Routes guarded tab changes and animates a selection that is also exposed to accessibility. */
export function RootTabActions<Name extends string>({
  controller,
  disabled,
  rootTabs,
}: RootTabActionsProps<Name>) {
  return (
    <>
      {rootTabItems.map(item => (
        <RootTabAction
          key={item.id}
          accessibilityLabel={item.accessibilityLabel}
          disabled={disabled}
          item={item}
          onPress={() => {
            if (rootTabs.activeTab === item.id) return;
            settleNavigationRequest(
              controller
                .requestTabSwitch()
                .then(allowed =>
                  allowed ? rootTabs.onSelect(item.id) : undefined,
                ),
            );
          }}
          selected={rootTabs.activeTab === item.id}
        />
      ))}
    </>
  );
}

/** Animates one tab's visual selection while updating its accessibility state immediately. */
function RootTabAction({
  item,
  accessibilityLabel,
  disabled,
  onPress,
  selected,
}: {
  readonly item: (typeof rootTabItems)[number];
  readonly accessibilityLabel: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly selected: boolean;
}) {
  const reduceMotion = useContext(NavigationMotionContext);
  const colorScheme = useColorScheme();
  const selectionProgress = useRef(
    new Animated.Value(selected ? 1 : 0),
  ).current;
  const previousSelection = useRef(selected);
  const unselectedForeground =
    colorScheme === 'dark'
      ? appColorPalettes.dark.secondary
      : appColorPalettes.light.secondary;
  const foregroundColor = selectionProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [unselectedForeground, appColorPalettes.light.onPrimary],
  });

  useEffect(() => {
    if (reduceMotion) {
      selectionProgress.stopAnimation();
      selectionProgress.setValue(selected ? 1 : 0);
      previousSelection.current = selected;
      return;
    }
    if (previousSelection.current === selected) return;
    previousSelection.current = selected;

    const animation = Animated.timing(selectionProgress, {
      toValue: selected ? 1 : 0,
      duration: 140,
      easing: Easing.out(Easing.cubic),
      // Color interpolation needs the JS driver; the native iOS bar animates in UIKit.
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, selected, selectionProgress]);

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.tab}
      testID={item.testID}
    >
      <Animated.View
        accessibilityElementsHidden
        pointerEvents="none"
        style={[styles.selectedBackground, { opacity: selectionProgress }]}
      />
      <Animated.Text style={[styles.symbol, { color: foregroundColor }]}>
        {item.fallbackSymbol}
      </Animated.Text>
      <Animated.Text style={[styles.label, { color: foregroundColor }]}>
        {item.label}
      </Animated.Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tab: {
    alignItems: 'center',
    borderRadius: 26,
    gap: 2,
    flex: 1,
    justifyContent: 'center',
    minHeight: ROOT_TAB_TOUCH_TARGET_HEIGHT,
    minWidth: 44,
    overflow: 'hidden',
    paddingHorizontal: 6,
    position: 'relative',
  },
  selectedBackground: {
    backgroundColor: appColors.primaryAction,
    borderRadius: 26,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  symbol: { fontSize: 22, lineHeight: 24 },
  label: { fontSize: 12, lineHeight: 16 },
});
