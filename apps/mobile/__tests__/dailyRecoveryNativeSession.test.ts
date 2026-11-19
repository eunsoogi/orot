import { openSqliteTestDatabase } from '../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyRecoveryNativeSession } from '../e2e/dailyRecoveryNativeSession';
import type { ConsentAuthorityState } from '../src/agent/execution/consentAuthority';
import type { ProviderSelection } from '../src/providers/selection/types';

// These ports are synthetic, not native Keychain proof. Native restart is tested separately.
jest.mock('../src/agent/execution/consentGeneration', () => ({
  createConsentGeneration: () => 'b'.repeat(64),
}));
jest.mock('../src/aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: () => {
    throw new Error('Provider forbidden');
  },
}));
jest.mock('../src/agent/execution/settingsConsentAuthorization', () => ({
  createSettingsConsentAuthorization: () => {
    throw new Error('Authorize forbidden');
  },
}));

test.each(['save', 'cancel', 'delete', 'revoke'] as const)(
  'same native fixture uses actual readonly owner/publication/local storage: %s',
  async action => {
    const db = openSqliteTestDatabase(':memory:');
    let authority: ConsentAuthorityState | null = null;
    let selection: ProviderSelection | null = null;
    let credential: string | null = null;
    const store = {
      database: db.database,
      authority: () => ({
        read: async () => authority,
        write: async (value: ConsentAuthorityState) => {
          authority = value;
        },
      }),
      selection: () => ({
        load: async () => selection,
        save: async (value: ProviderSelection) => {
          selection = value;
        },
        clear: async () => {
          selection = null;
        },
      }),
      recoveryCredential: {
        read: async () => credential,
        write: async (value: string) => {
          credential = value;
        },
      },
    };
    try {
      const staged = await createDailyRecoveryNativeSession(store).stage();
      expect(staged).toMatchObject({
        status: 'staged',
        pendingCount: 1,
        savedStatus: 'missing',
      });
      const reopened = createDailyRecoveryNativeSession(store);
      const metadata = await reopened.inspect();
      expect(Object.keys(metadata).sort()).toEqual([
        'authorizationExecution',
        'pendingCount',
        'providerExecution',
        'savedRevision',
        'savedStatus',
        'synthetic',
      ]);
      expect(metadata).toMatchObject({
        providerExecution: 'not-configured',
        authorizationExecution: 'not-configured',
        pendingCount: 1,
        savedStatus: 'missing',
      });
      if (action !== 'save') await reopened.invalidate(action);
      const afterRestart = createDailyRecoveryNativeSession(store);
      expect(await afterRestart.resume()).toMatchObject({
        status: action === 'save' ? 'saved' : 'unavailable',
        savedStatus: action === 'save' ? 'saved' : 'missing',
      });
      const repeated = await afterRestart.resume();
      expect(repeated).toMatchObject({
        status: 'unavailable',
        savedRevision: action === 'save' ? 1 : null,
      });
    } finally {
      db.close();
    }
  },
);
