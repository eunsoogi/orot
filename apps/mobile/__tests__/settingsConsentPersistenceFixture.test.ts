import { openSqliteTestDatabase } from '../../../packages/storage/__tests__/sqliteTestDatabase';
import { createSettingsConsentPersistenceFixture } from '../e2e/settingsConsentPersistenceFixture';
import type { ConsentAuthorityState } from '../src/agent/execution/consentAuthority';
import type { ProviderSelection } from '../src/providers/selection/types';
import type { SettingsConsentSlot } from '../src/storage/settingsConsentStorage';

// Recreated JS owners prove fixture phase semantics; actual process/Keychain restart
// is reserved for the registered native journey, not claimed by this SQLite test.
test('all three synthetic slots require approval and retained SQL cannot revive revoked owners', async () => {
  const db = openSqliteTestDatabase(':memory:');
  const authority = new Map<SettingsConsentSlot, ConsentAuthorityState>();
  const selection = new Map<SettingsConsentSlot, ProviderSelection>();
  let serial = 0;
  const input = {
    database: db.database,
    generation: () => (++serial).toString(16).padStart(64, '0'),
    authority: (slot: SettingsConsentSlot) => ({
      read: async () => authority.get(slot) ?? null,
      write: async (value: ConsentAuthorityState) => {
        authority.set(slot, { ...value });
      },
    }),
    selection: (slot: SettingsConsentSlot) => ({
      load: async () => selection.get(slot) ?? null,
      save: async (value: ProviderSelection) => {
        selection.set(slot, { ...value });
      },
      clear: async () => {
        selection.delete(slot);
      },
    }),
  };
  try {
    const initial = createSettingsConsentPersistenceFixture(input);
    expect((await initial.inspect()).observations).toEqual({
      conversation: 'renewal_required',
      calendar: 'renewal_required',
      voice: 'renewal_required',
    });
    for (const slot of ['conversation', 'calendar', 'voice'] as const)
      await initial.approve(slot);
    const reopened = createSettingsConsentPersistenceFixture(input);
    expect(await reopened.inspect()).toEqual({
      synthetic: true,
      providerExecution: 'not-configured',
      observations: {
        conversation: 'authorized',
        calendar: 'authorized',
        voice: 'authorized',
      },
    });
    await reopened.revoke(true);
    const rows = await db.database.execute(
      'SELECT COUNT(*) AS count FROM settings_inference_grants',
    );
    expect(rows.rows[0]?.count).toBe(3);
    const revokedRestart = createSettingsConsentPersistenceFixture(input);
    expect((await revokedRestart.inspect()).observations).toEqual({
      conversation: 'renewal_required',
      calendar: 'renewal_required',
      voice: 'renewal_required',
    });
  } finally {
    db.close();
  }
});
