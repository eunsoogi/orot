import type { NavigationRoute } from '../navigationController';
import { appContentLayoutOwner } from '../appContentLayoutPolicy';

function ownerFor(routeName: string) {
  const route: NavigationRoute<string> = { key: routeName, name: routeName };
  return typeof appContentLayoutOwner === 'function'
    ? appContentLayoutOwner(route)
    : appContentLayoutOwner;
}

// Source, restored analysis and legacy conversation entries measure their own usable lane.
test.each(['source-detail', 'saved-analysis', 'entry', 'health-summary'])(
  '%s owns its measured panels across the usable route lane',
  routeName => {
    expect(ownerFor(routeName)).toBe('screen');
  },
);
