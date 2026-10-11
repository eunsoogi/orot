import { createContext } from 'react';
import type { ReactNode } from 'react';
import type { NavigationRoute } from './navigationController';

export type NativeRouteParamList = {
  scene: { routeKey: string };
};

/** Bridges native stack keys to the app routes whose state and guards they retain. */
export interface NativeRouteRegistry {
  readonly routes: readonly NavigationRoute<string>[];
  readonly isTransitioning: boolean;
  readonly requestBack: () => Promise<boolean>;
  readonly renderRoute: (route: NavigationRoute<string>) => ReactNode;
}

export const NativeRouteRegistryContext =
  createContext<NativeRouteRegistry | null>(null);
