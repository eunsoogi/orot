import { openMigrationSqlite } from '../../../../../../packages/storage/__tests__/migrationSqliteDatabase';
import { createSettingsConsentStorage } from '../../../storage/settingsConsentStorage';
import type { ProviderSelectionOption } from '../../../providers/selection/types';
import { createConsentAuthority } from '../consentAuthority';
import { settingsConsentRecipient } from '../settingsConsentRecipient';
import { settingsSearchGrants } from '../settingsSearchGrants';
import { readSavedModelSearchChoices } from '../savedModelSearchChoices';
import type { SettingsConsentReadServices } from '../SettingsConsentReadServices';

const providerId = 'chatgpt-plan:synthetic';
const modelId = 'synthetic-model';
const option = {
  provider: { id: providerId, searchPublicWeb: jest.fn() },
  modelId,
  privacyBoundary: 'selected-context-remote',
} as unknown as ProviderSelectionOption;

test.each([
  'same',
  'unset',
  'different-credential',
  'different-model',
  'unreadable',
  'revoked',
] as const)(
  'hydrates only current exact stored search choices: %s',
  async scenario => {
    const opened = openMigrationSqlite(':memory:');
    try {
      const identity = {
        providerId,
        modelId,
        recipient: settingsConsentRecipient(providerId)!,
        authorityGeneration: 'synthetic-generation',
        credentialEpoch: 'synthetic-epoch',
      };
      const grants = createSettingsConsentStorage(opened.database);
      const saved = settingsSearchGrants(identity, {
        web: true,
        medical: false,
      })[0]!;
      const token = 'synthetic-search-consent';
      if (scenario !== 'unset') {
        await grants.stage('conversation', token, saved.grant, saved.domain);
        await grants.activate('conversation', token, () => true, saved.domain);
      }
      if (scenario === 'unreadable') {
        await opened.database.execute(
          "UPDATE settings_inference_grants SET grant_json='invalid' WHERE domain='public-web'",
        );
      }
      const reloaded = createSettingsConsentStorage(opened.database);
      let current = true;
      const services: SettingsConsentReadServices = {
        resolveOwner: async () => null,
        resolveTarget: async (slot, domain, target) => ({
          slot,
          domain,
          identity: {
            ...saved.grant.identity,
            modelId: target.modelId,
            credentialEpoch:
              scenario === 'different-credential'
                ? 'new-epoch'
                : identity.credentialEpoch,
          },
          isCurrent: () => current,
        }),
        readGrant: reloaded.read,
        readReviewGrant: reloaded.readReviewGrant,
      };
      const target =
        scenario === 'different-model'
          ? { ...option, modelId: 'other-model' }
          : option;
      const result = await readSavedModelSearchChoices(
        services,
        target,
        new AbortController().signal,
      );
      if (scenario === 'unreadable') {
        expect(result).toBeUndefined();
        expect(await reloaded.read('conversation', 'public-web')).toBeNull();
      } else {
        expect(result?.choices).toEqual({
          web: scenario === 'same' || scenario === 'revoked',
          medical: false,
        });
      }
      if (scenario === 'revoked') {
        current = false;
        expect(result?.current()).toBe(false);
      }
      if (scenario === 'same')
        expect(await reloaded.read('conversation', 'public-web')).toEqual(
          saved.grant,
        );
    } finally {
      opened.close();
    }
  },
);

test.each([
  'local-suspended',
  'durably-revoked',
  'active-without-identity',
  'authority-read-failure',
  'malformed-authority',
  'failed-authority-transition',
  'sql-read-failure',
] as const)(
  'distinguishes verified inactive from unknown settings: %s',
  async scenario => {
    const opened = openMigrationSqlite(':memory:');
    try {
      const local = scenario === 'local-suspended';
      const savedGeneration = 'a'.repeat(64);
      let generation = 10;
      let durable: unknown = {
        version: 1,
        generation: savedGeneration,
        status: 'active',
      };
      let readFails = false;
      let writeFails = false;
      const authority = createConsentAuthority(
        {
          async read() {
            if (readFails) throw new Error('synthetic authority failure');
            return durable;
          },
          async write(next) {
            if (writeFails)
              throw new Error('synthetic authority write failure');
            durable = next;
          },
        },
        () => (++generation).toString(16).padStart(64, '0'),
      );
      const grants = createSettingsConsentStorage(opened.database);
      const saved = settingsSearchGrants(
        {
          providerId,
          modelId,
          recipient: settingsConsentRecipient(providerId)!,
          authorityGeneration: savedGeneration,
          credentialEpoch: 'synthetic-epoch',
        },
        { web: false, medical: true },
      )[0]!;
      await grants.stage(
        'conversation',
        'synthetic-search-consent',
        saved.grant,
        saved.domain,
      );
      await grants.activate(
        'conversation',
        'synthetic-search-consent',
        () => true,
        saved.domain,
      );
      if (local) await authority.suspend();
      if (
        scenario === 'durably-revoked' ||
        scenario === 'sql-read-failure' ||
        scenario === 'authority-read-failure' ||
        scenario === 'failed-authority-transition'
      )
        await authority.revoke();
      if (scenario === 'authority-read-failure') readFails = true;
      if (scenario === 'malformed-authority')
        durable = { version: 1, status: 'revoked' };
      if (scenario === 'failed-authority-transition') {
        writeFails = true;
        await expect(authority.activate()).rejects.toThrow();
        writeFails = false;
      }
      if (scenario === 'sql-read-failure') {
        await opened.database.execute('DROP TABLE settings_inference_grants');
        await opened.database.execute(
          'CREATE VIEW settings_inference_grants AS SELECT * FROM missing_settings_table',
        );
      }
      const reloaded = createSettingsConsentStorage(opened.database);
      const result = await readSavedModelSearchChoices(
        {
          resolveOwner: async () => null,
          resolveTarget: async () => null,
          reviewInactiveConversationAuthority: authority.reviewInactive,
          readGrant: reloaded.read,
          readReviewGrant: reloaded.readReviewGrant,
        },
        local
          ? ({
              ...option,
              provider: { ...option.provider, id: 'apple-on-device' },
              privacyBoundary: 'on-device',
            } as ProviderSelectionOption)
          : option,
        new AbortController().signal,
      );
      if (local || scenario === 'durably-revoked') {
        expect(result?.choices).toEqual({ web: false, medical: false });
        expect(await authority.current()).toBeNull();
        expect(await reloaded.read('conversation', saved.domain)).toEqual(
          saved.grant,
        );
        expect(result?.current()).toBe(true);
        const changing = authority.activate();
        expect(result?.current()).toBe(false);
        await changing;
      } else {
        expect(result).toBeUndefined();
      }
    } finally {
      opened.close();
    }
  },
);
