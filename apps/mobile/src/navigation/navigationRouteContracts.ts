import type { NavigationRoute } from './navigationController';
import type { NavigationLeaveGuardOptions } from './navigationLeaveGuard';

export interface NavigationRouteOwnership {
  readonly isCurrent: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
}

/** Route actions retain their owning controller and leave-state contract. */
export interface NavigationRouteActions<Name extends string> {
  readonly route: NavigationRoute<Name>;
  readonly ownership?: NavigationRouteOwnership;
  readonly onBack: () => Promise<boolean>;
  readonly onHome: () => Promise<boolean>;
  readonly push: (name: Name) => NavigationRoute<Name> | null;
  readonly replace: (name: Name) => NavigationRoute<Name> | null;
  readonly registerLeaveState: (
    source: NavigationLeaveStateSource<Name>,
  ) => () => void;
}

export type NavigationLeaveStateSource<Name extends string> = Pick<
  NavigationLeaveGuardOptions<Name>,
  'readState'
> &
  Partial<Pick<NavigationLeaveGuardOptions<Name>, 'confirm' | 'stopRecording'>>;
