import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { resolveSelectedAiProvider } from '../../aiFeatures/integration/provider';
import { resolveCalendarModel } from '../../calendarModelSettings/resolveCalendarModel';
import { calendarModelStore } from '../../calendarModelSettings/calendarModelStore';
import { providerSelectionStore } from '../../providers/selection/keychainSelectionStore';
import { voiceSettingsStore } from '../../voiceSettings/voiceSettingsStore';
import { voiceSelectionMutation } from '../../voiceSettings/voiceConsentIdentity';
import { settingsConsentAuthority } from '../../storage/settingsConsentAuthority';
import { settingsConsentCredential } from './settingsConsentCredential';
import type { SettingsConsentOwner } from './settingsConsentAuthorization';
import type {
  SettingsConsentDomain,
  SettingsConsentSlot,
} from '../../storage/settingsConsentStorage';
import { t } from '../../i18n';

/** Resolves the actual persisted owner afresh; a request cannot nominate an account
 * or turn an unknown purpose into an approved feature. The authorization layer also
 * checks the closed purpose/category catalog before retaining its live witness. */
export async function resolveSettingsConsentOwner(
  request: OutboundProcessingRequest,
): Promise<SettingsConsentOwner | null> {
  const purpose = request.consentScope?.purpose;
  if (!purpose || request.signal.aborted) return null;
  const domain: SettingsConsentDomain =
    purpose === 'public_web_search'
      ? 'public-web'
      : purpose === 'public_medical_search'
        ? 'medical-search'
        : 'model';
  const slot: SettingsConsentSlot =
    purpose === 'calendar_classification'
      ? 'calendar'
      : purpose === 'realtime_audio' || purpose === 'realtime_result'
        ? 'voice'
        : 'conversation';
  const selectionCurrent =
    slot === 'voice'
      ? voiceSelectionMutation.capture()
      : (slot === 'calendar'
          ? calendarModelStore
          : providerSelectionStore
        ).liveWitness();
  if (!selectionCurrent) return null;
  let selected: { providerId: string; modelId: string; recipient: string };
  if (slot === 'voice') {
    const value = await voiceSettingsStore.load();
    if (value.mode !== 'openai-api' || !value.hasApiKey) return null;
    selected = {
      providerId: 'openai-realtime',
      modelId: value.model,
      recipient: 'OpenAI Realtime API',
    };
  } else {
    const value = await (slot === 'calendar'
      ? resolveCalendarModel()
      : resolveSelectedAiProvider());
    if (
      value.status !== 'ready' ||
      (!value.remoteProcessing && domain !== 'medical-search')
    )
      return null;
    selected = {
      providerId: value.provider.id,
      modelId: value.modelId,
      recipient: value.recipient,
    };
  }
  const credential = await settingsConsentCredential(selected.providerId);
  if (!credential || !selectionCurrent()) return null;
  const expected =
    domain === 'medical-search'
      ? {
          providerId: 'europe-pmc',
          modelId: 'public-medical-search',
          recipient: 'Europe PMC',
        }
      : domain === 'public-web'
        ? {
            ...selected,
            recipient: t('externalMedicalEvidence.publicSearchRecipient', {
              recipient: selected.recipient,
            }),
          }
        : selected;
  if (
    request.providerId !== expected.providerId ||
    request.modelId !== expected.modelId ||
    request.recipient !== expected.recipient
  )
    return null;
  const owner = settingsConsentAuthority(slot);
  const state = await owner.current();
  if (
    !state ||
    !credential.isCurrent() ||
    !selectionCurrent() ||
    request.signal.aborted
  )
    return null;
  const authorityCurrent = owner.witness(state.generation);
  return {
    slot,
    domain,
    identity: {
      ...expected,
      authorityGeneration: state.generation,
      credentialEpoch: credential.epoch,
    },
    subscribeInvalidation: listener => {
      const a = owner.subscribe(listener);
      const b = credential.subscribe(listener);
      const c =
        slot === 'voice'
          ? voiceSelectionMutation.subscribe(listener)
          : (slot === 'calendar'
              ? calendarModelStore
              : providerSelectionStore
            ).subscribeChanges(listener);
      return () => {
        a();
        b();
        c();
      };
    },
    isCurrent: () =>
      !request.signal.aborted &&
      selectionCurrent() &&
      credential.isCurrent() &&
      authorityCurrent(),
  };
}
