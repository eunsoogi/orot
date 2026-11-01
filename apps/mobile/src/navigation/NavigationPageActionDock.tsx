import { useLayoutEffect, useRef } from 'react';
import {
  ActionSheetIOS,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { navigationText } from '../i18n/navigation';
import { NavigationActionButton } from './NavigationActionButton';
import type { NavigationSurface } from './NavigationActionBar';
import type {
  NavigationGlassAction,
  NavigationGlassSurfaceProps,
} from './NavigationGlassSurface';
import { settleNavigationRequest } from './nativeNavigationActions';
import { splitPageActions } from './navigationPageActionLayout';
import { useNavigationContentFrame } from './navigationContentFrame';
import type { NavigationRouteAction } from './useNavigationPrimaryAction';

/** One page-owned group shares the navigation overlay's measured clearance. */
export function NavigationPageActionDock({
  actions,
  capacity,
  disabled,
  isDarkAppearance,
  isRail,
  routeKey,
  surface: Surface,
  surfaceProps,
}: {
  actions: readonly NavigationRouteAction[];
  capacity: number;
  disabled: boolean;
  isDarkAppearance: boolean;
  isRail: boolean;
  routeKey: string;
  surface: NavigationSurface;
  surfaceProps: Partial<NavigationGlassSurfaceProps>;
}) {
  const current = useRef({ actions, routeKey, disabled });
  current.current = { actions, routeKey, disabled };
  const alive = useRef(true);
  const sheetOpen = useRef(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (sheetOpen.current) ActionSheetIOS.dismissActionSheet();
    };
  }, []);
  const { width, fontScale } = useWindowDimensions();
  const contentFrame = useNavigationContentFrame();
  const availableWidth = contentFrame?.availableContentFrame.width ?? width;
  const bottomCapacity = Math.max(
    1,
    Math.floor((availableWidth - 40) / (120 * Math.max(1, fontScale))),
  );
  const { visible, overflow } = splitPageActions(
    actions,
    isRail ? capacity : bottomCapacity,
  );
  const invoke = (id: string) => {
    const now = current.current;
    const action = now.actions.find(item => item.id === id);
    if (
      !alive.current ||
      now.routeKey !== routeKey ||
      now.disabled ||
      !action ||
      action.disabled
    )
      return;
    settleNavigationRequest(Promise.resolve(action.onPress()));
  };
  const showOverflow = () => {
    if (
      !alive.current ||
      current.current.routeKey !== routeKey ||
      current.current.disabled
    )
      return;
    const names = overflow.map(action => action.label);
    sheetOpen.current = true;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...names, navigationText.closeActionMenu],
        cancelButtonIndex: names.length,
        disabledButtonIndices: overflow.flatMap((action, index) =>
          action.disabled || disabled ? [index] : [],
        ),
      },
      index => {
        sheetOpen.current = false;
        const selected = overflow[index];
        if (selected) invoke(selected.id);
      },
    );
  };
  const more: NavigationRouteAction = {
    id: 'overflow',
    label: '더 보기',
    accessibilityLabel: '화면 동작 더 보기',
    testID: 'navigation-page-action-overflow',
    systemImageName: 'ellipsis',
    onPress: showOverflow,
  };
  const shown = overflow.length ? [...visible, more] : visible;
  const descriptors: NavigationGlassAction[] = shown.map(action => ({
    id: `page:${action.id}`,
    label: action.label,
    accessibilityLabel: action.accessibilityLabel,
    testID: action.testID,
    disabled: disabled || action.disabled,
    busy: action.busy,
    primary: true,
    ...(isRail
      ? { systemImageName: action.systemImageName ?? 'ellipsis' }
      : {}),
  }));
  const dispatch = (id: string) =>
    id === 'overflow' ? showOverflow() : invoke(id);
  return (
    <Surface
      {...surfaceProps}
      actions={descriptors}
      isPageDock
      onAction={({ nativeEvent }) =>
        dispatch(nativeEvent.id.replace(/^page:/, ''))
      }
      testID="navigation-page-action-surface"
    >
      <View style={styles.actions}>
        {shown.map(action => (
          <NavigationActionButton
            accessibilityLabel={action.accessibilityLabel}
            busy={action.busy}
            disabled={disabled || action.disabled === true}
            isDarkAppearance={isDarkAppearance}
            key={action.id}
            label={action.label}
            onPress={() => dispatch(action.id)}
            primary
            testID={action.testID}
          />
        ))}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({ actions: { flexDirection: 'row', gap: 8 } });
