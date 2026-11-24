import {
  createConsentAuthority,
  type ConsentAuthorityPersistence,
} from '../src/agent/execution/consentAuthority';
import { createConsentGeneration } from '../src/agent/execution/consentGeneration';
import {
  settingsPermissionsForFeature,
  SETTINGS_CONSENT_CATALOG_VERSION,
} from '../src/agent/execution/settingsConsentCatalog';
import type { ModelSettingsServices } from '../src/agent/execution/ModelSettingsServices';
import type { SqlDatabase } from '@orot/storage';
import { createSettingsConsentStorage } from '../src/storage/settingsConsentStorage';
import {
  readSettingsVoicePairSelection,
  type SettingsVoicePairSelection,
} from '../src/storage/settingsVoicePairSelection';
import { commitReviewedVoicePair } from '../src/voiceSettings/commitReviewedVoicePair';
import {
  liveResponsesPermissions,
  liveResponsesProviderId,
  liveResponsesRecipient,
} from '../src/voiceSettings/liveResponsesSettingsIdentity';
import {
  liveVoiceProviderId,
  liveVoiceRecipient,
} from '../src/agent/execution/liveVoiceSettingsIdentity';

/** This probe never initializes product Keychain, credentials or providers.
 * Both decisions persist with the production joint coordinator on isolated SQL. */
export function createSettingsConsentVoicePairFixture(input: {
  readonly database: SqlDatabase;
  readonly voice: ConsentAuthorityPersistence;
  readonly tools: ConsentAuthorityPersistence;
  readonly generation?: () => string;
}) {
  const generate = input.generation ?? createConsentGeneration;
  const audio = createConsentAuthority(input.voice, generate);
  const tools = createConsentAuthority(input.tools, generate);
  const grants = createSettingsConsentStorage(input.database);
  const credentialEpoch = '42'.repeat(32);
  const read = () => readSettingsVoicePairSelection(input.database);
  const selection = async () => {
    const pair = await read();
    return pair
      ? { providerId: liveVoiceProviderId, modelId: pair.speechModel }
      : null;
  };
  const capture = async (pair: SettingsVoicePairSelection) => {
    const [voice, responses] = await Promise.all([
      audio.current(),
      tools.current(),
    ]);
    if (
      voice?.generation !== pair.voiceGeneration ||
      responses?.generation !== pair.responsesGeneration
    )
      return () => false;
    const voiceCurrent = audio.witness(pair.voiceGeneration);
    const toolsCurrent = tools.witness(pair.responsesGeneration);
    return () => voiceCurrent() && toolsCurrent();
  };
  const commit: NonNullable<
    ModelSettingsServices['voicePair']
  >['commit'] = async ({ pair, current: requestedCurrent, signal }) => {
    const current = () =>
      !signal.aborted && requestedCurrent() && pair.accountRevision === 1;
    const prior = await read();
    const target = (slot: 'voice' | 'voice-responses') => {
      const speech = slot === 'voice';
      return {
        slot,
        authority: speech ? audio : tools,
        grant: (generation: string) => ({
          version: 1 as const,
          catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
          identity: {
            providerId: speech ? liveVoiceProviderId : liveResponsesProviderId,
            modelId: speech ? pair.speechModel : pair.backendModel,
            recipient: speech ? liveVoiceRecipient : liveResponsesRecipient,
            authorityGeneration: generation,
            credentialEpoch,
          },
          permissions: speech
            ? settingsPermissionsForFeature('voice', liveVoiceProviderId)
            : liveResponsesPermissions,
        }),
      };
    };
    let published: SettingsVoicePairSelection | undefined;
    await commitReviewedVoicePair(
      [target('voice'), target('voice-responses')],
      {
        stageGrant: (slot, token, grant) => grants.stage(slot, token, grant),
        cancelGrant: grants.cancel,
        async stagePair() {
          return current();
        },
        async isPriorPairCurrent(slot, generation) {
          const observed = await read();
          return Boolean(
            prior &&
            observed &&
            observed.voiceGeneration === prior.voiceGeneration &&
            observed.responsesGeneration === prior.responsesGeneration &&
            generation ===
              (slot === 'voice'
                ? prior.voiceGeneration
                : prior.responsesGeneration),
          );
        },
        async publishTogether(entries, generations, witness) {
          published = {
            version: 1,
            speechModel: pair.speechModel,
            backendModel: pair.backendModel,
            credentialEpoch,
            voiceGeneration: generations.voice,
            responsesGeneration: generations['voice-responses'],
          };
          await grants.activateJointScopes(
            entries.map(entry => ({ ...entry, domain: 'model' as const })),
            witness,
            true,
            published,
          );
        },
      },
      current,
    );
    if (!published) return () => false;
    const witness = await capture(published);
    return () => current() && witness();
  };
  return {
    audio,
    selection,
    credentialEpoch,
    commit,
    revokeTools: () => tools.revoke(),
    async inspectTools() {
      const pair = await read();
      if (!pair) return 'renewal_required';
      const grant = await grants.read('voice-responses', 'model');
      if (
        !grant ||
        grant.identity.providerId !== liveResponsesProviderId ||
        grant.identity.modelId !== pair.backendModel ||
        grant.identity.recipient !== liveResponsesRecipient ||
        grant.identity.credentialEpoch !== credentialEpoch ||
        grant.identity.authorityGeneration !== pair.responsesGeneration ||
        JSON.stringify(grant.permissions) !==
          JSON.stringify(liveResponsesPermissions)
      )
        return 'renewal_required';
      return (await capture(pair))() ? 'authorized' : 'renewal_required';
    },
  };
}
