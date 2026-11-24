import type { SqlDatabase } from '@orot/storage';
import { commitSettingsConsent } from '../src/agent/execution/commitSettingsConsent';
import { createConsentAuthority } from '../src/agent/execution/consentAuthority';
import { createConsentGeneration } from '../src/agent/execution/consentGeneration';
import { SETTINGS_CONSENT_CATALOG_VERSION } from '../src/agent/execution/settingsConsentCatalog';
import { createSettingsConsentStorage } from '../src/storage/settingsConsentStorage';
import {
  readSettingsVoicePairSelection,
  type SettingsVoicePairSelection,
} from '../src/storage/settingsVoicePairSelection';
import {
  canonicalHealthBinding,
  canonicalHealthSlot,
  type CanonicalHealthBinding,
} from '../src/voiceSettings/liveCanonicalHealthBinding';
import { canonicalHealthPermission } from '../src/voiceSettings/liveCanonicalHealthSettings';
import {
  liveResponsesProviderId,
  liveResponsesRecipient,
  liveResponsesPermissions,
} from '../src/voiceSettings/liveResponsesSettingsIdentity';
import type { openSettingsConsentNativeStore } from './settingsConsentNativeStore';

type NativeStore = Awaited<ReturnType<typeof openSettingsConsentNativeStore>>;
type Store = Pick<
  NativeStore,
  | 'authority'
  | 'voiceResponsesAuthority'
  | 'canonicalHealthAuthority'
  | 'stageCanonicalNativeWitness'
>;

/** Only the existing UUID-isolated simulator fixture supplies these stores.
 * No production settings/keychain repository, network or grant export is used. */
export function createCanonicalSettingsConsentFixture(input: {
  database: SqlDatabase;
  native: Store;
  generation?: () => string;
}) {
  const generated = input.generation ?? createConsentGeneration;
  const audio = createConsentAuthority(
    input.native.authority('voice'),
    generated,
  );
  const baseline = createConsentAuthority(
    input.native.voiceResponsesAuthority,
    generated,
  );
  const companion = createConsentAuthority(
    input.native.canonicalHealthAuthority,
    generated,
  );
  const sql = createSettingsConsentStorage(input.database);
  type Pair = SettingsVoicePairSelection;
  type Request = {
    signal: AbortSignal;
    owner: () => boolean;
    unlocked: () => Promise<boolean>;
  };
  const grantMatches = (
    grant: Awaited<ReturnType<typeof sql.read>>,
    pair: Pair,
    generation: string,
    permissions: unknown,
  ) =>
    !!grant &&
    grant.catalogVersion === SETTINGS_CONSENT_CATALOG_VERSION &&
    grant.identity.providerId === liveResponsesProviderId &&
    grant.identity.recipient === liveResponsesRecipient &&
    grant.identity.authorityGeneration === generation &&
    grant.identity.credentialEpoch === pair.credentialEpoch &&
    grant.identity.modelId === pair.backendModel &&
    JSON.stringify(grant.permissions) === JSON.stringify(permissions);
  const ownedPair = async (request: Request) => {
    const live = () => !request.signal.aborted && request.owner();
    if (!live() || !(await request.unlocked()) || !live()) return;
    const pair = await readSettingsVoicePairSelection(input.database);
    if (!pair || pair.speechModel !== 'gpt-live-1.1' || !live()) return;
    if (
      (await audio.current())?.generation !== pair.voiceGeneration ||
      (await baseline.current())?.generation !== pair.responsesGeneration ||
      !live()
    )
      return;
    const audioCurrent = audio.witness(pair.voiceGeneration);
    const toolCurrent = baseline.witness(pair.responsesGeneration);
    const current = () => live() && audioCurrent() && toolCurrent();
    const pairCurrent = async () => {
      if (!current() || !(await request.unlocked()) || !current()) return false;
      const [fresh, speechOwner, toolOwner] = await Promise.all([
        readSettingsVoicePairSelection(input.database),
        audio.current(),
        baseline.current(),
      ]);
      if (
        !current() ||
        speechOwner?.generation !== pair.voiceGeneration ||
        toolOwner?.generation !== pair.responsesGeneration ||
        JSON.stringify(fresh) !== JSON.stringify(pair)
      )
        return false;
      // SQL revocation can keep the saved pair and native mirrors unchanged.
      const grant = await sql.read('voice-responses', 'model');
      return (
        current() &&
        grantMatches(
          grant,
          pair,
          pair.responsesGeneration,
          liveResponsesPermissions,
        )
      );
    };
    return (await pairCurrent()) ? { pair, current, pairCurrent } : undefined;
  };
  return {
    async invoke(request: Request, dispatch: () => Promise<boolean>) {
      const owner = await ownedPair(request);
      const active = owner && (await companion.current());
      if (!owner || !active || !owner.current()) return false;
      const same = companion.witness(active.generation);
      const proves = async () => {
        if (!(await owner.pairCurrent()) || !same() || !owner.current())
          return false;
        const grant = await sql.read(canonicalHealthSlot, 'model');
        return (
          same() &&
          owner.current() &&
          grantMatches(grant, owner.pair, active.generation, [
            canonicalHealthPermission,
          ])
        );
      };
      return (await proves()) && (await dispatch()) && (await proves());
    },
    async approve(request: Request & { confirm: () => Promise<boolean> }) {
      const captured = await ownedPair(request);
      if (!captured) return false;
      const { pair, current, pairCurrent } = captured;
      if (!current() || !(await request.confirm()) || !(await pairCurrent()))
        return false;
      let witness: CanonicalHealthBinding | undefined;
      let staged = false;
      await commitSettingsConsent({
        slot: canonicalHealthSlot,
        authority: companion,
        grants: sql,
        makeGrant(generation) {
          witness = canonicalHealthBinding(
            generation,
            {
              generation: pair.responsesGeneration,
              grantID: pair.responsesGeneration + '-model',
              backendModel: pair.backendModel,
            },
            pair.credentialEpoch,
          );
          return {
            version: 1,
            catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
            identity: {
              providerId: liveResponsesProviderId,
              modelId: pair.backendModel,
              recipient: liveResponsesRecipient,
              authorityGeneration: generation,
              credentialEpoch: pair.credentialEpoch,
            },
            permissions: [canonicalHealthPermission],
          };
        },
        async saveSelection() {
          if (!witness || !(await pairCurrent()))
            throw new Error('Synthetic pair is no longer current');
          staged = await input.native.stageCanonicalNativeWitness({
            pair,
            companion: witness,
            current,
          });
          if (!staged || !(await pairCurrent()))
            throw new Error('Synthetic pair is no longer current');
        },
        isSelectionCurrent: async () => staged && (await pairCurrent()),
        isPreviousSelectionCurrent: async () => false,
        isCredentialCurrent: pairCurrent,
        isRequestCurrent: current,
        signal: request.signal,
      });
      return staged && (await pairCurrent());
    },
  };
}
