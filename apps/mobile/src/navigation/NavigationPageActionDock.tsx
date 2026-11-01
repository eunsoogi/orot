import { useLayoutEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { navigationText } from '../i18n/navigation';
import { NavigationActionButton } from './NavigationActionButton';
import type { NavigationSurface } from './NavigationActionBar';
import {
  NavigationGlassSurface,
  type NavigationGlassAction,
  type NavigationGlassSurfaceProps,
} from './NavigationGlassSurface';
import { settleNavigationRequest } from './nativeNavigationActions';
import {
  splitMeasuredPageActions,
  splitPageActions,
} from './navigationPageActionLayout';
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
  const [metrics, setMetrics] = useState<{
    revision: string;
    width: number;
    widths: number[];
  }>();
  const nativeBottom =
    !isRail && Platform.OS === 'ios' && Surface === NavigationGlassSurface;
  const revision = JSON.stringify([
    routeKey,
    width,
    fontScale,
    actions.map(action => [
      action.id,
      action.label,
      action.disabled,
      action.busy,
    ]),
  ]);
  const contentFrame = useNavigationContentFrame();
  const availableWidth = contentFrame?.availableContentFrame.width ?? width;
  const bottomCapacity = Math.max(
    1,
    Math.floor((availableWidth - 40) / (120 * Math.max(1, fontScale))),
  );
  const split = nativeBottom
    ? metrics?.revision === revision
      ? splitMeasuredPageActions(actions, metrics.widths, metrics.width)
      : { visible: [], overflow: actions }
    : splitPageActions(actions, isRail ? capacity : bottomCapacity);
  const { visible, overflow } = split;
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
  const describe = (action: NavigationRouteAction): NavigationGlassAction => ({
    id: `page:${action.id}`,
    label: action.label,
    accessibilityLabel: action.accessibilityLabel,
    testID: action.testID,
    disabled: disabled || action.disabled,
    busy: action.busy,
    primary: true,
    ...(isRail || action.id === 'overflow'
      ? { systemImageName: action.systemImageName ?? 'ellipsis' }
      : {}),
  });
  const descriptors = shown.map(describe);
  const dispatch = (id: string) =>
    id === 'overflow' ? showOverflow() : invoke(id);
  return (
    <Surface
      {...surfaceProps}
      actions={descriptors}
      isPageDock
      pageMetricsRequest={
        nativeBottom
          ? { revision, actions: [...actions, more].map(describe) }
          : undefined
      }
      onPageMetrics={
        nativeBottom
          ? ({ nativeEvent }) => {
              if (nativeEvent.revision === revision) setMetrics(nativeEvent);
            }
          : undefined
      }
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
