import { openMigrationSqlite } from '../../../../../packages/storage/__tests__/migrationSqliteDatabase';
import { SETTINGS_CONSENT_CATALOG_VERSION } from '../../agent/execution/settingsConsentCatalog';
import { createSettingsConsentStorage } from '../../storage/settingsConsentStorage';
import {
  liveVoiceAudioPolicy,
  liveVoiceAudioPurpose,
  liveVoiceModelId,
  liveVoiceProviderId,
  liveVoiceRecipient,
} from '../../agent/execution/liveVoiceSettingsIdentity';
import {
  liveResponsesPermissions,
  liveResponsesAggregateV2Permissions,
  liveResponsesProviderId,
  liveResponsesRecipient,
} from '../../voiceSettings/liveResponsesSettingsIdentity';

/** Persist real Settings grants in an isolated synthetic database, not a fake allow verdict. */
export function openLiveAudioSettingsFixture() {
  const sql = openMigrationSqlite(':memory:');
  const repo = createSettingsConsentStorage(sql.database);
  const epoch = 'a'.repeat(64);
  const generation = 'c'.repeat(64);
  const managed = {
    backendModel: 'gpt-6-sol',
    generation,
    grantID: generation + '-model',
  };
  const identity = {
    providerId: liveVoiceProviderId,
    modelId: liveVoiceModelId,
    recipient: liveVoiceRecipient,
    credentialEpoch: epoch,
    authorityGeneration: 'b'.repeat(64),
  };
  return {
    repo,
    identity,
    managed,
    epoch,
    close: sql.close,
    async seed({
      audio,
      tool,
      wrongRecipient,
      headless = false,
    }: {
      audio: boolean;
      tool: boolean;
      wrongRecipient: boolean;
      headless?: boolean;
    }) {
      if (audio) {
        await repo.stage('voice', 'synthetic-audio-activation', {
          version: 1,
          catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
          identity: wrongRecipient
            ? { ...identity, recipient: 'Another service' }
            : identity,
          permissions: [
            {
              purpose: liveVoiceAudioPurpose,
              policyVersion: liveVoiceAudioPolicy,
              dataCategories: ['live_voice_audio', 'voice_conversation'],
              sourceKinds: [],
            },
          ],
        });
        await repo.activate('voice', 'synthetic-audio-activation', () => true);
      }
      if (tool) {
        await repo.stage('voice-responses', 'synthetic-managed-activation', {
          version: 1,
          catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
          identity: {
            providerId: liveResponsesProviderId,
            recipient: liveResponsesRecipient,
            modelId: managed.backendModel,
            credentialEpoch: epoch,
            authorityGeneration: generation,
          },
          permissions: headless
            ? liveResponsesAggregateV2Permissions
            : liveResponsesPermissions,
        });
        await repo.activate(
          'voice-responses',
          'synthetic-managed-activation',
          () => true,
        );
      }
    },
  };
}
