import type { NavigationRoute } from './navigationController';
import type { NavigationLeaveGuardOptions } from './navigationLeaveGuard';

/** Route actions retain their owning controller and leave-state contract. */
export interface NavigationRouteActions<Name extends string> {
  readonly route: NavigationRoute<Name>;
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
