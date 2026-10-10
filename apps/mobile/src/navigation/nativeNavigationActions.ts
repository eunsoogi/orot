import { navigationText } from '../i18n/navigation';
import type { NavigationPrimaryAction } from './NavigationActionBar';
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
  primaryAction,
}: {
  readonly controller: NavigationController<Name>;
  readonly snapshot: NavigationSnapshot<Name>;
  readonly backDisabled: boolean;
  readonly canGoHome: boolean;
  readonly primaryAction?: NavigationPrimaryAction;
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

  const onAction: NavigationGlassActionEventHandler = ({ nativeEvent }) => {
    if (nativeEvent.id === 'back' && snapshot.canGoBack && !backDisabled) {
      settleNavigationRequest(controller.requestBack());
      return;
    }
    if (nativeEvent.id === 'home' && canGoHome && !backDisabled) {
      settleNavigationRequest(controller.requestHome());
      return;
    }
    if (
      nativeEvent.id === 'primary' &&
      primaryAction &&
      !backDisabled &&
      !primaryAction.disabled
    ) {
      settleNavigationRequest(Promise.resolve(primaryAction.onPress()));
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
