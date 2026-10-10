import { navigationText } from '../i18n/navigation';
import type { NavigationPrimaryAction } from './NavigationActionBar';
import { rootTabItems } from './rootTabs';
import type { NavigationRootTabs } from './rootTabs';
import type {
  NavigationGlassAction,
  NavigationGlassActionEventHandler,
} from './NavigationGlassSurface';
import type {
  NavigationController,
  NavigationSnapshot,
} from './navigationController';

/** Convert existing route actions into UIKit items and preserve their JS handlers. */
export function createNativeNavigationBindings<Name extends string>({
  controller,
  snapshot,
  backDisabled,
  canGoHome,
  homeAction,
  primaryAction,
  rootTabs,
}: {
  readonly controller: NavigationController<Name>;
  readonly snapshot: NavigationSnapshot<Name>;
  readonly backDisabled: boolean;
  readonly canGoHome: boolean;
  readonly homeAction?: () => void | Promise<unknown>;
  readonly primaryAction?: NavigationPrimaryAction;
  readonly rootTabs?: NavigationRootTabs;
}): {
  readonly actions: readonly NavigationGlassAction[];
  readonly onAction: NavigationGlassActionEventHandler;
} {
  const actions: NavigationGlassAction[] = [];
  if (snapshot.canGoBack) {
    actions.push({
      id: 'back',
      label: navigationText.back.label,
      accessibilityLabel: navigationText.back.accessibilityLabel,
      testID: 'navigation-back',
      systemImageName: 'chevron.backward',
      showsTitleWithSystemImage: true,
      disabled: backDisabled,
    });
  }
  if (canGoHome) {
    actions.push({
      id: 'home',
      label: navigationText.home.label,
      accessibilityLabel: navigationText.home.accessibilityLabel,
      testID: 'navigation-home',
      systemImageName: 'house',
      showsTitleWithSystemImage: true,
      titleBelowImage: true,
      disabled: backDisabled,
    });
  }
  if (primaryAction) {
    actions.push({
      id: 'primary',
      label: primaryAction.label,
      accessibilityLabel: primaryAction.accessibilityLabel,
      testID: primaryAction.testID,
      disabled: backDisabled || primaryAction.disabled === true,
      primary: true,
    });
  }
  if (rootTabs) {
    rootTabItems.forEach(item =>
      actions.push({
        id: `tab-${item.id}`,
        label: item.label,
        accessibilityLabel: item.accessibilityLabel,
        testID: item.testID,
        systemImageName:
          rootTabs.activeTab === item.id
            ? item.selectedSystemImageName
            : item.systemImageName,
        disabled: backDisabled,
        selected: rootTabs.activeTab === item.id,
        showsTitleWithSystemImage: true,
        titleBelowImage: true,
      }),
    );
  }

  const onAction: NavigationGlassActionEventHandler = ({ nativeEvent }) => {
    if (nativeEvent.id === 'back' && snapshot.canGoBack && !backDisabled) {
      settleNavigationRequest(controller.requestBack());
      return;
    }
    if (nativeEvent.id === 'home' && canGoHome && !backDisabled) {
      settleNavigationRequest(
        Promise.resolve(homeAction?.() ?? controller.requestHome()),
      );
      return;
    }
    if (
      nativeEvent.id === 'primary' &&
      primaryAction &&
      !backDisabled &&
      !primaryAction.disabled
    ) {
      settleNavigationRequest(Promise.resolve(primaryAction.onPress()));
      return;
    }
    const tab = rootTabItems.find(item => `tab-${item.id}` === nativeEvent.id);
    if (tab && rootTabs && rootTabs.activeTab !== tab.id && !backDisabled) {
      settleNavigationRequest(
        controller
          .requestTabSwitch()
          .then(allowed => (allowed ? rootTabs.onSelect(tab.id) : undefined)),
      );
    }
  };

  return { actions, onAction };
}

export function settleNavigationRequest(request: Promise<unknown>): void {
  request.then(
    () => undefined,
    () => undefined,
  );
}
