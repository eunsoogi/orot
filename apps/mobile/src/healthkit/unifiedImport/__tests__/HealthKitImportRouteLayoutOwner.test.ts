import type { NavigationRoute } from '../../../navigation/navigationController';
import { appContentLayoutOwner } from '../../../navigation/appContentLayoutPolicy';

describe('health import route layout ownership', () => {
  it('gives the import screen the full usable lane for its adaptive panels', () => {
    // The screen owns its panels, so the route scene must not constrain its measured width.
    const route: NavigationRoute<string> = {
      key: 'unified-import',
      name: 'unified-import',
    };

    const owner =
      typeof appContentLayoutOwner === 'function'
        ? appContentLayoutOwner(route)
        : appContentLayoutOwner;

    expect(owner).toBe('screen');
  });
});
