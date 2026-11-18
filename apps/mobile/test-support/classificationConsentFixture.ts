import { openSqliteTestDatabase } from '../../../packages/storage/__tests__/sqliteTestDatabase';
import { createSettingsConsentUiServices } from '../e2e/settingsConsentUiServices';
import type { ConsentAuthorityState } from '../src/agent/execution/consentAuthority';
import type { SettingsConsentSlot } from '../src/storage/settingsConsentStorage';
import type { ProviderSelection } from '../src/providers/selection/types';

/** Real SQLite grants and coordinator; synthetic protected authority/selection ports. */
export function classificationConsentFixture() {
  const db = openSqliteTestDatabase(':memory:');
  const states = new Map<SettingsConsentSlot, ConsentAuthorityState>();
  const selections = new Map<SettingsConsentSlot, ProviderSelection>();
  let generation = 0;
  const input = createSettingsConsentUiServices({
    database: db.database,
    generation: () => (++generation).toString(16).padStart(64, '0'),
    authority: slot => ({
      read: async () => states.get(slot) ?? null,
      write: async value => {
        states.set(slot, value);
      },
    }),
    selection: slot => ({
      load: async () => selections.get(slot) ?? null,
      save: async value => {
        selections.set(slot, value);
      },
      clear: async () => {
        selections.delete(slot);
      },
    }),
  });
  return {
    input,
    db,
    states,
    selections,
    reads: input.fixture.authorizationServices('calendar'),
  };
}
