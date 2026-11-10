import { navigationText } from '../i18n/navigation';
import type { NavigationRouteAction } from './useNavigationPrimaryAction';

/** Keep the shared More action's identity stable across page layouts. */
export function navigationPageOverflowAction(
  onPress: () => void,
): NavigationRouteAction {
  return {
    id: 'overflow',
    ...navigationText.pageOverflow,
    testID: 'navigation-page-action-overflow',
    systemImageName: 'ellipsis',
    onPress,
  };
}
