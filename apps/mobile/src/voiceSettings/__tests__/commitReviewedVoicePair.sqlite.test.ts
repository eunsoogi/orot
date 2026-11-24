import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  createConsentAuthority,
  type ConsentAuthorityState,
} from '../../agent/execution/consentAuthority';
import {
  liveVoiceModelId,
  liveVoiceProviderId,
  liveVoiceRecipient,
} from '../../agent/execution/liveVoiceSettingsIdentity';
import { settingsPermissionsForFeature } from '../../agent/execution/settingsConsentCatalog';
import type { SettingsConsentGrant } from '../../agent/execution/settingsConsentGrant';
import { readSettingsVoicePairSelection } from '../../storage/settingsVoicePairSelection';
import { createSettingsConsentStorage } from '../../storage/settingsConsentStorage';
import { commitReviewedVoicePair } from '../commitReviewedVoicePair';
import {
  liveResponsesProviderId,
  liveResponsesRecipient,
} from '../liveResponsesSettingsIdentity';

type Slot = 'voice' | 'voice-responses';
const slots = ['voice', 'voice-responses'] as const;

test.each([
  'success',
  'retire during staging',
  'retire before publication',
  'mismatched backend',
] as const)(
  'both voice grant scopes remain hidden until a single protected publication: %s',
  async scenario => {
    const db = openSqliteTestDatabase(':memory:');
    try {
      const store = createSettingsConsentStorage(db.database);
      let current = true;
      let sequence = 0;
      const authority = () => {
        let saved: ConsentAuthorityState | null = null;
        return createConsentAuthority(
          {
            read: async () => saved,
            write: async value => {
              saved = value;
            },
          },
          () => (++sequence).toString(16).padStart(64, '0'),
        );
      };
      const target = (slot: Slot) => {
        const audio = slot === 'voice';
        const providerId = audio
          ? liveVoiceProviderId
          : liveResponsesProviderId;
        return {
          slot,
          authority: authority(),
          grant: (generation: string): SettingsConsentGrant => ({
            version: 1,
            catalogVersion: 'model-settings-v1',
            identity: {
              providerId,
              modelId: audio ? liveVoiceModelId : 'gpt-6-sol',
              recipient: audio ? liveVoiceRecipient : liveResponsesRecipient,
              credentialEpoch: 'a'.repeat(64),
              authorityGeneration: generation,
            },
            permissions: settingsPermissionsForFeature(slot, providerId),
          }),
        };
      };
      const scope = [target('voice'), target('voice-responses')] as const;
      const visibility = () => Promise.all(slots.map(slot => store.read(slot)));
      const publish = jest.fn(
        async (
          choices: readonly { readonly slot: Slot; readonly token: string }[],
          generations: { voice: string; 'voice-responses': string },
          isCurrent: () => boolean,
        ) => {
          expect(await visibility()).toEqual([null, null]);
          if (scenario === 'retire before publication') current = false;
          await store.activateJointScopes(
            choices.map(choice => ({ ...choice, domain: 'model' as const })),
            isCurrent,
            true,
            {
              version: 1,
              speechModel: liveVoiceModelId,
              backendModel:
                scenario === 'mismatched backend' ? 'gpt-6-luna' : 'gpt-6-sol',
              credentialEpoch: 'a'.repeat(64),
              voiceGeneration: generations.voice,
              responsesGeneration: generations['voice-responses'],
            },
          );
        },
      );
      const pending = commitReviewedVoicePair(
        scope,
        {
          stageGrant: (slot, token, grant) => store.stage(slot, token, grant),
          cancelGrant: store.cancel,
          isPriorPairCurrent: async () => false,
          stagePair: async () => {
            expect(await visibility()).toEqual([null, null]);
            if (scenario === 'retire during staging') current = false;
            return true;
          },
          publishTogether: publish,
        },
        () => current,
      );
      if (scenario === 'success') {
        await expect(pending).resolves.toBeUndefined();
        const active = await visibility();
        expect(await readSettingsVoicePairSelection(db.database)).toMatchObject(
          { backendModel: 'gpt-6-sol' },
        );
        expect(active.map(grant => grant?.identity.modelId)).toEqual([
          liveVoiceModelId,
          'gpt-6-sol',
        ]);
        await store.clear();
        expect(await visibility()).toEqual([null, null]);
        expect(await readSettingsVoicePairSelection(db.database)).toMatchObject(
          { backendModel: 'gpt-6-sol' },
        );
      } else {
        await expect(pending).rejects.toThrow();
        expect(await readSettingsVoicePairSelection(db.database)).toBeNull();
        expect(await visibility()).toEqual([null, null]);
      }
      expect(publish).toHaveBeenCalledTimes(
        scenario === 'retire during staging' ? 0 : 1,
      );
    } finally {
      db.close();
    }
  },
);
