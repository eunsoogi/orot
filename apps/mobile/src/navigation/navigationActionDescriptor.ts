import { navigationText } from '../i18n/navigation';
import type { NavigationGlassAction } from './NavigationGlassSurface';
import type { NavigationRouteAction } from './useNavigationPrimaryAction';

/** One descriptor is used for both UIKit measurement and the displayed action. */
export function pageActionDescriptor(
  action: NavigationRouteAction,
  disabled: boolean,
  isRail: boolean,
): NavigationGlassAction {
  return {
    id: `page:${action.id}`,
    label: action.navigationLabel ?? action.label,
    accessibilityLabel: action.accessibilityLabel,
    testID: action.testID,
    disabled: disabled || action.disabled,
    busy: action.busy,
    primary: true,
    ...(isRail
      ? { systemImageName: action.systemImageName ?? 'ellipsis' }
      : action.systemImageName
        ? {
            systemImageName: action.systemImageName,
            showsTitleWithSystemImage: true,
            titleBelowImage: true,
          }
        : {}),
  };
}

/** More joins root tabs only on bottom layouts; it never acquires selection. */
export function navigationMoreDescriptor(root: boolean): NavigationGlassAction {
  return {
    id: root ? 'navigation-overflow' : 'page:overflow',
    label: navigationText.navigationOverflow.label,
    accessibilityLabel: navigationText.navigationOverflow.accessibilityLabel,
    testID: 'navigation-page-action-overflow',
    systemImageName: 'ellipsis',
    showsTitleWithSystemImage: true,
    titleBelowImage: true,
    rootTab: root,
    primary: !root,
  };
}
