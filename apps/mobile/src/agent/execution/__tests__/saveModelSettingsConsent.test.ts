import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createSettingsConsentStorage } from '../../../storage/settingsConsentStorage';
import { settingsConsentRepository } from '../../../storage/settingsConsentRepository';
import { settingsConsentAuthority } from '../../../storage/settingsConsentAuthority';
import { settingsConsentCredential } from '../settingsConsentCredential';
import {
  createConsentAuthority,
  type ConsentAuthorityState,
} from '../consentAuthority';
import { saveModelSettingsConsent } from '../saveModelSettingsConsent';
import type { ProviderSelection } from '../../../providers/selection/types';

jest.mock('../../../storage/settingsConsentRepository', () => ({
  settingsConsentRepository: jest.fn(),
}));
jest.mock('../../../storage/settingsConsentAuthority', () => ({
  settingsConsentAuthority: jest.fn(),
}));
jest.mock('../settingsConsentCredential', () => ({
  settingsConsentCredential: jest.fn(),
}));

// Only native ownership persistence is substituted. Grant staging/activation uses real SQLite.
function fixture() {
  const connection = openSqliteTestDatabase(':memory:');
  const grants = createSettingsConsentStorage(connection.database);
  let persisted: ConsentAuthorityState | null = null;
  let sequence = 0;
  const authority = createConsentAuthority(
    {
      read: async () => persisted,
      write: async value => {
        persisted = { ...value };
      },
    },
    () => (++sequence).toString(16).padStart(64, '0'),
  );
  jest.mocked(settingsConsentRepository).mockResolvedValue(grants);
  jest.mocked(settingsConsentAuthority).mockReturnValue(authority);
  let credentialCurrent = true;
  jest.mocked(settingsConsentCredential).mockImplementation(async () => ({
    epoch: 'synthetic-credential',
    isCurrent: () => credentialCurrent,
    subscribe: () => () => {},
  }));
  let selected: ProviderSelection | null = null;
  const input = {
    slot: 'conversation' as const,
    selection: {
      providerId: 'openai-api-decisions',
      modelId: 'synthetic-model',
    },
    recipient: 'OpenAI API',
    remote: true,
    store: {
      load: async () => selected,
      save: jest.fn(async (value: ProviderSelection) => {
        selected = value;
      }),
      clear: async () => {
        selected = null;
      },
    },
    signal: new AbortController().signal,
    isCurrent: () => true,
  };
  return {
    connection,
    grants,
    authority,
    input,
    invalidate: () => {
      credentialCurrent = false;
    },
  };
}

afterEach(() => jest.clearAllMocks());

test('model settings approval does not implicitly approve either search recipient', async () => {
  const f = fixture();
  try {
    await saveModelSettingsConsent(f.input);
    const grant = await f.grants.read('conversation');
    expect(grant?.identity.authorityGeneration).toBe(
      (await f.authority.current())?.generation,
    );
    expect(grant?.identity.recipient).toBe('OpenAI API');
    expect(await f.grants.read('conversation', 'medical-search')).toBeNull();
    expect(await f.grants.read('conversation', 'public-web')).toBeNull();
  } finally {
    f.connection.close();
  }
});

test('explicit independent medical approval works with a local selection without approving public web', async () => {
  const f = fixture();
  try {
    await saveModelSettingsConsent({
      ...f.input,
      remote: false,
      selection: { providerId: 'synthetic-local', modelId: 'local' },
      recipient: 'On device',
      search: { medical: true, web: false },
    });
    const medical = await f.grants.read('conversation', 'medical-search');
    expect(medical?.identity).toMatchObject({
      providerId: 'europe-pmc',
      modelId: 'public-medical-search',
      recipient: 'Europe PMC',
    });
    expect(medical?.permissions.map(value => value.purpose)).toEqual([
      'public_medical_search',
    ]);
    expect(medical?.identity.authorityGeneration).toBe(
      (await f.authority.current())?.generation,
    );
    expect(await f.grants.read('conversation', 'public-web')).toBeNull();
  } finally {
    f.connection.close();
  }
});

test('credential mutation during selection save cannot activate any selected recipient', async () => {
  const f = fixture();
  f.input.store.save.mockImplementationOnce(async () => {
    f.invalidate();
  });
  try {
    await expect(
      saveModelSettingsConsent({
        ...f.input,
        search: { medical: true, web: true },
      }),
    ).rejects.toThrow();
    expect(await f.authority.current()).toBeNull();
    for (const domain of ['model', 'medical-search', 'public-web'] as const)
      expect(await f.grants.read('conversation', domain)).toBeNull();
  } finally {
    f.connection.close();
  }
});
