import { useNavigationGeometry } from './NavigationGeometryProvider';
import { hasNavigationDuoGeometry } from './navigationDuoGeometry';

/** Action ownership follows observed Duo capability, independently of the bar's current side. */
export function useNavigationActionPlacement(): 'contextual' | 'header' {
  return hasNavigationDuoGeometry(useNavigationGeometry())
    ? 'contextual'
    : 'header';
}
