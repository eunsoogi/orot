import { StyleSheet, View } from 'react-native';
import { NavigationActionButton } from './NavigationActionButton';
import type { NavigationSurface } from './NavigationActionBar';
import {
  navigationMoreDescriptor,
  pageActionDescriptor,
} from './navigationActionDescriptor';
import { settleNavigationRequest } from './nativeNavigationActions';
import type { NavigationRouteAction } from './useNavigationPrimaryAction';

/** The bottom planner owns visibility; this surface dispatches only its direct controls. */
export function NavigationBottomPageActions({
  actions,
  disabled,
  height,
  includeMore,
  isDarkAppearance,
  onMore,
  pageWidths,
  moreWidth,
  surface: Surface,
}: {
  actions: readonly NavigationRouteAction[];
  disabled: boolean;
  height: number;
  includeMore: boolean;
  isDarkAppearance: boolean;
  onMore: () => void;
  pageWidths?: readonly (number | undefined)[];
  moreWidth?: number;
  surface: NavigationSurface;
}) {
  const descriptors = actions.map((action, index) => ({
    ...pageActionDescriptor(action, disabled, false),
    layoutWidth: pageWidths?.[index],
  }));
  if (includeMore)
    descriptors.push({
      ...navigationMoreDescriptor(false),
      disabled,
      layoutWidth: moreWidth,
    });
  const dispatch = (id: string) => {
    if (disabled) return;
    if (id === 'page:overflow') return onMore();
    const action = actions.find(item => `page:${item.id}` === id);
    if (action && !action.disabled)
      settleNavigationRequest(Promise.resolve(action.onPress()));
  };
  return (
    <Surface
      actions={descriptors}
      layoutMode="bottom"
      bottomHeight={height}
      isPageDock
      onAction={({ nativeEvent }) => dispatch(nativeEvent.id)}
      testID="navigation-page-action-surface"
    >
      <View style={styles.actions}>
        {actions.map(action => (
          <NavigationActionButton
            key={action.id}
            accessibilityLabel={action.accessibilityLabel}
            busy={action.busy}
            disabled={disabled || action.disabled === true}
            isDarkAppearance={isDarkAppearance}
            label={action.navigationLabel ?? action.label}
            onPress={() => dispatch(`page:${action.id}`)}
            primary
            testID={action.testID}
          />
        ))}
        {includeMore ? (
          <NavigationActionButton
            accessibilityLabel="탐색 및 화면 동작 더 보기"
            disabled={disabled}
            isDarkAppearance={isDarkAppearance}
            label="더 보기"
            onPress={onMore}
            primary
            testID="navigation-page-action-overflow"
          />
        ) : null}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({ actions: { flexDirection: 'row', gap: 8 } });
