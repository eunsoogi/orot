import type { ReactNode } from 'react';
import type {
  NavigationPrimaryAction,
  NavigationSurface,
} from './NavigationActionBar';
import type {
  NavigationGlassAction,
  NavigationGlassActionEventHandler,
} from './NavigationGlassSurface';
import type { NavigationRouteAction } from './useNavigationPrimaryAction';

export interface NavigationActionBarPresentationProps {
  readonly actions: readonly NavigationGlassAction[];
  readonly bottomActions: ReactNode;
  readonly isDarkAppearance: boolean;
  readonly keyboardHeight: number;
  readonly keyboardVisible: boolean;
  readonly onAction: NavigationGlassActionEventHandler;
  readonly primaryAction?: NavigationPrimaryAction;
  readonly pageActions?: readonly NavigationRouteAction[];
  readonly pageActionsDisabled?: boolean;
  readonly routeKey?: string;
  readonly reclaimRootTabInset: boolean;
  readonly safeAreaHandledByParent: boolean;
  readonly surface: NavigationSurface;
  readonly availableWidthOverride?: number;
}
