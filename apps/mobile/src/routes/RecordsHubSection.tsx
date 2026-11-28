import type { ReactNode } from 'react';
import { NavigationRouteScrollView } from '../navigation/NavigationRouteScrollView';

/** The Records root keeps its scroll owner mounted behind its native stack destinations. */
export function RecordsHubSection({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <NavigationRouteScrollView>{children}</NavigationRouteScrollView>;
}
