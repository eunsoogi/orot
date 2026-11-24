import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  createConsentAuthority,
  type ConsentAuthorityState,
} from '../../agent/execution/consentAuthority';
import {
  SETTINGS_CONSENT_CATALOG_VERSION,
  settingsPermissionsForFeature,
} from '../../agent/execution/settingsConsentCatalog';
import {
  liveVoiceModelId,
  liveVoiceProviderId,
  liveVoiceRecipient,
} from '../../agent/execution/liveVoiceSettingsIdentity';
import type { SettingsConsentGrant } from '../../agent/execution/settingsConsentGrant';
import { createSettingsConsentStorage } from '../../storage/settingsConsentStorage';
import { captureLegacyVoicePairRollback } from '../captureLegacyVoicePairRollback';
import { commitReviewedVoicePair } from '../commitReviewedVoicePair';
import { createVoicePairSettingsAdapter } from '../createVoicePairSettingsAdapter';
import { binding } from '../liveResponsesSettingsBinding';
import {
  liveResponsesProviderId,
  liveResponsesRecipient,
} from '../liveResponsesSettingsIdentity';
import type { StoredVoiceSettings } from '../voiceSettingsTypes';

const epoch = 'a'.repeat(64);
const initial = ['b'.repeat(64), 'c'.repeat(64)] as const;

test.each([
  'stage failure',
  'cancel during staging',
  'changed account',
  'publication uncertainty',
] as const)(
  'legacy speech and tool recovery after migration: %s',
  async scenario => {
    const db = openSqliteTestDatabase(':memory:');
    try {
      const store = createSettingsConsentStorage(db.database);
      let revision = 5;
      let active = true;
      let sequence = 0;
      let raw: StoredVoiceSettings = {
        mode: 'openai-api',
        model: liveVoiceModelId,
        apiKey: 'synthetic',
        credentialEpoch: epoch,
      };
      const voice = createVoicePairSettingsAdapter({
        read: async () => raw,
        write: async value => {
          raw = value;
        },
        enqueue: task => task(),
        settle: async () => {},
        currentRevision: () => revision,
        beginMutation: () => () => {},
        readSelection: async () => null,
      });
      const inputs = (['voice', 'voice-responses'] as const).map(
        (slot, idx) => {
          let authority: ConsentAuthorityState = {
            version: 1,
            status: 'active',
            generation: initial[idx]!,
          };
          const audio = slot === 'voice';
          const providerId = audio
            ? liveVoiceProviderId
            : liveResponsesProviderId;
          return {
            slot,
            authority: createConsentAuthority(
              {
                read: async () => authority,
                write: async value => {
                  authority = value;
                },
              },
              () => (++sequence).toString(16).padStart(64, '0'),
            ),
            grant: (generation: string): SettingsConsentGrant => ({
              version: 1,
              catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
              identity: {
                providerId,
                modelId: audio ? liveVoiceModelId : 'gpt-6-luna',
                recipient: audio ? liveVoiceRecipient : liveResponsesRecipient,
                credentialEpoch: epoch,
                authorityGeneration: generation,
              },
              permissions: settingsPermissionsForFeature(slot, providerId),
            }),
          };
        },
      );
      for (const [index, target] of inputs.entries()) {
        const id = initial[index]!;
        await store.stage(target.slot, id + '-model', target.grant(id));
        await store.activate(target.slot, id + '-model', () => true);
      }
      const rollback = await captureLegacyVoicePairRollback({
        epoch,
        unchangedAccount: () => revision === 5,
        readLegacyEpoch: voice.legacyVoiceRollbackEpoch,
        readGrant: store.read,
        readResponsesBinding: async () =>
          binding(initial[1], epoch, 'gpt-6-luna'),
      });
      const publish = jest.fn(async () => {
        throw new Error('synthetic ambiguous commit');
      });
      await expect(
        commitReviewedVoicePair(
          [inputs[0]!, inputs[1]!],
          {
            stageGrant: (slot, token, grant) => store.stage(slot, token, grant),
            cancelGrant: store.cancel,
            isPriorPairCurrent: rollback,
            stagePair: async generations => {
              await voice.stageVoicePair(
                {
                  pair: {
                    version: 1,
                    speechModel: liveVoiceModelId,
                    backendModel: 'gpt-6-sol',
                    voiceGeneration: generations.voice,
                    responsesGeneration: generations['voice-responses'],
                    credentialEpoch: epoch,
                  },
                  preferences: { schema: 1, language: 'ko', voice: 'noeul' },
                },
                5,
                () => active,
              );
              if (scenario === 'changed account') revision += 1;
              if (scenario === 'cancel during staging') active = false;
              if (scenario === 'stage failure')
                throw new Error('synthetic precommit storage failure');
              return true;
            },
            publishTogether: publish,
          },
          () => active && revision === 5,
        ),
      ).rejects.toThrow();
      const recovered =
        scenario === 'stage failure' || scenario === 'cancel during staging';
      for (const [idx, target] of inputs.entries()) {
        expect((await target.authority.current())?.generation ?? null).toBe(
          recovered ? initial[idx] : null,
        );
        expect(
          (await store.read(target.slot))?.identity.authorityGeneration,
        ).toEqual(initial[idx]);
      }
      expect(publish).toHaveBeenCalledTimes(
        scenario === 'publication uncertainty' ? 1 : 0,
      );
    } finally {
      db.close();
    }
  },
);
