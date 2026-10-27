import type { NavigationRoute } from '../navigationController';
import { appContentLayoutOwner } from '../appContentLayoutPolicy';

// The adapter accepts either one shared owner or a route-specific resolver.
function ownerFor(route: NavigationRoute<string>) {
  return typeof appContentLayoutOwner === 'function'
    ? appContentLayoutOwner(route)
    : appContentLayoutOwner;
}

describe('settings provider layout ownership', () => {
  it('gives only the provider settings route the full lane for its measured panels', () => {
    expect(ownerFor({ key: 'provider', name: 'settings-provider' })).toBe(
      'screen',
    );
    expect(ownerFor({ key: 'backup', name: 'settings-backup' })).toBe('scene');
  });
});
