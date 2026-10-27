import type { NavigationRoute } from '../navigationController';
import { appContentLayoutOwner } from '../appContentLayoutPolicy';

// The adapter accepts either one shared owner or a route-specific resolver.
function ownerFor(route: NavigationRoute<string>) {
  return typeof appContentLayoutOwner === 'function'
    ? appContentLayoutOwner(route)
    : appContentLayoutOwner;
}

describe('settings provider layout ownership', () => {
  it('keeps provider, backup, and sync status panels screen-owned', () => {
    expect(ownerFor({ key: 'provider', name: 'settings-provider' })).toBe(
      'screen',
    );
    expect(ownerFor({ key: 'backup', name: 'settings-backup' })).toBe('screen');
    expect(ownerFor({ key: 'sync', name: 'settings-sync-status' })).toBe(
      'screen',
    );
  });
});
