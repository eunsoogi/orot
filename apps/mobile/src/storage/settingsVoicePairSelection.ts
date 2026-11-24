import type { SqlExecutor } from '@orot/storage';
import { parseSettingsConsentGrant } from '../agent/execution/settingsConsentGrant';
import {
  liveVoiceModelId,
  liveVoiceProviderId,
  liveVoiceRecipient,
} from '../agent/execution/liveVoiceSettingsIdentity';
import {
  isLiveResponsesBackend,
  liveResponsesProviderId,
  liveResponsesRecipient,
  type LiveResponsesBackend,
} from '../voiceSettings/liveResponsesSettingsIdentity';

/** This local preference is independent of revocable grants. It never carries a key. */
export type SettingsVoicePairSelection = Readonly<{
  version: 1;
  speechModel: typeof liveVoiceModelId;
  backendModel: LiveResponsesBackend;
  credentialEpoch: string;
  voiceGeneration: string;
  responsesGeneration: string;
}>;

const hex = /^[a-f0-9]{64}$/;
const valid = (v: unknown): v is string => typeof v === 'string' && hex.test(v);

function parse(value: unknown): SettingsVoicePairSelection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<SettingsVoicePairSelection>;
  if (
    Object.keys(candidate).length !== 6 ||
    candidate.version !== 1 ||
    candidate.speechModel !== liveVoiceModelId ||
    !isLiveResponsesBackend(candidate.backendModel) ||
    !valid(candidate.credentialEpoch) ||
    !valid(candidate.voiceGeneration) ||
    !valid(candidate.responsesGeneration) ||
    candidate.voiceGeneration === candidate.responsesGeneration
  )
    return null;
  return Object.freeze(candidate as SettingsVoicePairSelection);
}

export const voicePairSelectionSchema =
  'CREATE TABLE IF NOT EXISTS settings_voice_pair_selection (slot INTEGER PRIMARY KEY CHECK (slot = 1), pair_json TEXT NOT NULL)';

/** Store in the same protected SQL transaction that activates both grants. */
export async function writeSettingsVoicePairSelection(
  tx: SqlExecutor,
  pair: SettingsVoicePairSelection,
) {
  if (!parse(pair)) throw new Error('Invalid voice pair record');
  await tx.execute(voicePairSelectionSchema);
  await tx.execute(
    'INSERT OR REPLACE INTO settings_voice_pair_selection (slot, pair_json) VALUES (1, ?)',
    [JSON.stringify(pair)],
  );
}

export async function readSettingsVoicePairSelection(
  tx: SqlExecutor,
): Promise<SettingsVoicePairSelection | null> {
  const initialized = await tx.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='settings_voice_pair_selection'",
  );
  if (initialized.rows.length === 0) return null;
  const result = await tx.execute(
    'SELECT pair_json FROM settings_voice_pair_selection WHERE slot=1',
  );
  if (result.rows.length === 0) return null;
  const raw: unknown = result.rows[0]?.pair_json;
  const parsed = typeof raw === 'string' && parse(JSON.parse(raw));
  if (!parsed || result.rows.length !== 1)
    throw new Error('Saved voice pair unavailable');
  return parsed;
}

/** Keep writes to this preference impossible through ordinary one-slot activation. */
export function authorizeVoicePairPublication(
  pair: SettingsVoicePairSelection | undefined,
  entries: readonly { slot: string; token: string; domain: string }[],
  explicitlySealed: boolean,
) {
  if (!pair) return;
  if (
    !parse(pair) ||
    !explicitlySealed ||
    entries.length !== 2 ||
    entries[0]?.slot !== 'voice' ||
    entries[1]?.slot !== 'voice-responses' ||
    entries[0]?.token !== pair.voiceGeneration + '-model' ||
    entries[1]?.token !== pair.responsesGeneration + '-model' ||
    entries.some(entry => entry.domain !== 'model')
  )
    throw new Error('Voice pair publication owner changed');
}

/** Exact recipient, model, credential, and authority must match the pair. */
export function assertPendingVoicePairGrant(
  pair: SettingsVoicePairSelection | undefined,
  slot: string,
  raw: unknown,
) {
  const grant =
    typeof raw === 'string' && parseSettingsConsentGrant(JSON.parse(raw));
  if (!grant) throw new Error('Pending permission invalid');
  if (!pair) return;
  const { identity } = grant;
  const speech = slot === 'voice';
  if (
    identity.credentialEpoch !== pair.credentialEpoch ||
    identity.providerId !==
      (speech ? liveVoiceProviderId : liveResponsesProviderId) ||
    identity.modelId !== (speech ? pair.speechModel : pair.backendModel) ||
    identity.recipient !==
      (speech ? liveVoiceRecipient : liveResponsesRecipient) ||
    identity.authorityGeneration !==
      (speech ? pair.voiceGeneration : pair.responsesGeneration)
  )
    throw new Error('Voice pair grant does not match selection');
}
