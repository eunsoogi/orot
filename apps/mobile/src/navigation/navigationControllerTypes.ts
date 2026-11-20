export type NavigationIntent = 'back' | 'home' | 'tab';

export interface NavigationRoute<Name extends string> {
  readonly key: string;
  readonly name: Name;
}

export interface NavigationTransition<Name extends string> {
  readonly intent: NavigationIntent;
  readonly from: NavigationRoute<Name>;
  readonly to: NavigationRoute<Name>;
}

export type NavigationLeaveGuard<Name extends string> = (
  transition: NavigationTransition<Name>,
  onExplicitDecline?: () => void,
) => boolean | Promise<boolean>;

export interface NavigationSnapshot<Name extends string> {
  readonly routes: readonly NavigationRoute<Name>[];
  readonly currentRoute: NavigationRoute<Name>;
  readonly canGoBack: boolean;
  readonly isTransitioning: boolean;
}

export interface NavigationController<Name extends string> {
  getSnapshot: () => NavigationSnapshot<Name>;
  subscribe: (listener: () => void) => () => void;
  subscribeEntryAvailability: (listener: () => void) => () => void;
  setLeaveStateAvailability: (routeKey: string, available: boolean) => void;
  push: (name: Name) => NavigationRoute<Name> | null;
  replace: (name: Name) => NavigationRoute<Name> | null;
  registerLeaveGuard: (
    routeKey: string,
    guard: NavigationLeaveGuard<Name>,
  ) => () => void;
  requestBack: () => Promise<boolean>;
  reconcileNativeBack: (routeKey: string) => boolean;
  requestHome: () => Promise<boolean>;
  requestTabSwitch: (commitApprovedTab?: () => void) => Promise<boolean>;
  /** Consume one unchanged tab decision and collapse to the existing root. */
  commitApprovedRoot: (expectedRouteKey: string) => boolean;
  requestTabSwitchDecision: () => Promise<
    'approved' | 'declined' | 'unavailable' | 'busy'
  >;
}
