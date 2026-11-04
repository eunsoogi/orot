import type { NavigationRoute } from '../navigationController';
import { appContentLayoutOwner } from '../appContentLayoutPolicy';

function ownerFor(routeName: string) {
  const route: NavigationRoute<string> = { key: routeName, name: routeName };
  return typeof appContentLayoutOwner === 'function'
    ? appContentLayoutOwner(route)
    : appContentLayoutOwner;
}

// Source detail measures its panels against the full usable lane.
test.each(['source-detail'])(
  '%s owns its measured source panels across the usable route lane',
  routeName => {
    expect(ownerFor(routeName)).toBe('screen');
  },
);
