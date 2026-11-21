import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createSettingsConsentStorage } from '../../../storage/settingsConsentStorage';
import {
  createConsentAuthority,
  type ConsentAuthorityState,
} from '../consentAuthority';
import { commitSettingsConsent } from '../commitSettingsConsent';
import type { SettingsConsentGrant } from '../settingsConsentGrant';

async function fixture() {
  const connection = openSqliteTestDatabase(':memory:');
  let persisted: ConsentAuthorityState | null = null;
  let sequence = 0;
  const persistence = {
    read: async () => persisted,
    write: async (value: ConsentAuthorityState) => {
      persisted = { ...value };
    },
  };
  const create = () =>
    createConsentAuthority(persistence, () =>
      (++sequence).toString(16).padStart(64, '0'),
    );
  const authority = create();
  const grants = createSettingsConsentStorage(connection.database);
  const make = (generation: string, modelId: string): SettingsConsentGrant => ({
    version: 1,
    catalogVersion: 'v1',
    identity: {
      providerId: 'p',
      modelId,
      recipient: 'Synthetic',
      authorityGeneration: generation,
      credentialEpoch: 'synthetic-credential',
    },
    permissions: [
      {
        purpose: 'record_conversation',
        policyVersion: 'v1',
        dataCategories: ['conversation'],
        sourceKinds: ['personal_record'],
      },
    ],
  });
  const old = await authority.activate();
  await grants.stage(
    'conversation',
    old.generation,
    make(old.generation, 'old'),
  );
  await grants.activate('conversation', old.generation, () => true);
  let selected = 'old';
  const controller = new AbortController();
  const input = {
    slot: 'conversation' as const,
    authority,
    grants,
    makeGrant: (generation: string) => make(generation, 'new'),
    saveSelection: jest.fn(async () => {
      selected = 'new';
    }),
    isSelectionCurrent: async () => selected === 'new',
    isPreviousSelectionCurrent: async () => selected === 'old',
    isCredentialCurrent: async () => true,
    isRequestCurrent: () => true,
    signal: controller.signal,
  };
  return { connection, create, old, input, controller };
}

test('successful settings commit exposes only the exact newly active selection and grant', async () => {
  const f = await fixture();
  try {
    await commitSettingsConsent(f.input);
    const active = await f.create().current();
    const grant = await f.input.grants.read('conversation');
    expect(active?.generation).toBe(grant?.identity.authorityGeneration);
    expect(grant?.identity.modelId).toBe('new');
  } finally {
    f.connection.close();
  }
});

test('selection save failure restores the proven unchanged prior grant and never reports success', async () => {
  const f = await fixture();
  f.input.saveSelection.mockRejectedValueOnce(
    new Error('Synthetic save failure'),
  );
  try {
    await expect(commitSettingsConsent(f.input)).rejects.toThrow(
      'Synthetic save failure',
    );
    expect(await f.create().current()).toEqual(f.old);
    expect((await f.input.grants.read('conversation'))?.identity.modelId).toBe(
      'old',
    );
  } finally {
    f.connection.close();
  }
});

test('activation failure after selection changed remains durably suspended even if cleanup fails', async () => {
  const f = await fixture();
  jest
    .spyOn(f.input.grants, 'activate')
    .mockRejectedValue(new Error('Synthetic activation failure'));
  jest
    .spyOn(f.input.grants, 'cancel')
    .mockRejectedValue(new Error('Synthetic cleanup failure'));
  try {
    await expect(commitSettingsConsent(f.input)).rejects.toThrow(
      'Synthetic activation failure',
    );
    expect(await f.create().current()).toBeNull();
    expect((await f.input.grants.read('conversation'))?.identity.modelId).toBe(
      'old',
    );
  } finally {
    f.connection.close();
  }
});

test('cancel before save preserves selection and previous authorization without a provider call', async () => {
  const f = await fixture();
  f.controller.abort();
  try {
    await expect(commitSettingsConsent(f.input)).rejects.toThrow('cancelled');
    expect(f.input.saveSelection).not.toHaveBeenCalled();
    expect(await f.create().current()).toEqual(f.old);
  } finally {
    f.connection.close();
  }
});

test('explicit recipient decisions activate together; omitted recipients never inherit the new authority', async () => {
  const f = await fixture();
  try {
    await commitSettingsConsent({
      ...f.input,
      additionalGrants: generation => [
        {
          domain: 'public-web',
          grant: {
            ...f.input.makeGrant(generation),
            identity: {
              ...f.input.makeGrant(generation).identity,
              recipient: 'Synthetic search',
            },
          },
        },
      ],
    });
    const authority = await f.create().current();
    expect(
      (await f.input.grants.read('conversation'))?.identity.authorityGeneration,
    ).toBe(authority?.generation);
    expect(
      (await f.input.grants.read('conversation', 'public-web'))?.identity
        .authorityGeneration,
    ).toBe(authority?.generation);
    expect(
      await f.input.grants.read('conversation', 'medical-search'),
    ).toBeNull();
  } finally {
    f.connection.close();
  }
});

test('a second recipient write failure rolls back joint grants and stays suspended after restart', async () => {
  const f = await fixture();
  try {
    await f.connection.database.execute(`CREATE TRIGGER reject_web_activation
      BEFORE UPDATE ON settings_inference_grants
      WHEN NEW.domain = 'public-web' AND NEW.state = 'active'
      BEGIN SELECT RAISE(ABORT, 'Synthetic second recipient failure'); END`);
    await expect(
      commitSettingsConsent({
        ...f.input,
        additionalGrants: generation => [
          { domain: 'public-web', grant: f.input.makeGrant(generation) },
        ],
      }),
    ).rejects.toThrow('second recipient');
    expect(await f.create().current()).toBeNull();
    expect((await f.input.grants.read('conversation'))?.identity).toMatchObject(
      {
        authorityGeneration: f.old.generation,
        modelId: 'old',
      },
    );
    expect(await f.input.grants.read('conversation', 'public-web')).toBeNull();
  } finally {
    f.connection.close();
  }
});
