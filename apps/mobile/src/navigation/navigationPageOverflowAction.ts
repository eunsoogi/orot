import type { NavigationRouteAction } from './useNavigationPrimaryAction';

/** Keep the shared More action's identity stable across page layouts. */
export function navigationPageOverflowAction(
  onPress: () => void,
): NavigationRouteAction {
  return {
    id: 'overflow',
    label: '더 보기',
    accessibilityLabel: '화면 동작 더 보기',
    testID: 'navigation-page-action-overflow',
    systemImageName: 'ellipsis',
    onPress,
  };
}
