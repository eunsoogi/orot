import { APPLE_PCC_PROVIDER_ID } from '@orot/provider-apple';
import type { ExecutionConsentPort } from '@orot/agent-runtime';
import type { resolveSelectedAiProvider } from '../aiFeatures/integration/provider';
import type { ProviderSelection } from '../providers/selection/types';
import { providerSelectionStore } from '../providers/selection/keychainSelectionStore';
import { bindRemoteEncounterPageAuthority } from './remoteEncounterPageAuthority';
import { encounterPageModel } from './encounterPageModel';
import { extractLocalTranscriptPages } from './extractLocalTranscriptPages';
import { openLocalTranscriptPages } from './localTranscriptPages';

/** A remote long review keeps only a live owner, not reusable payload approval. */
export async function admitRemoteLongEncounter(input: {
  readonly choice: ProviderSelection;
  readonly selectionCurrent: () => boolean;
  readonly sourceId: string;
  readonly lifetime: AbortSignal;
  readonly signal: AbortSignal;
  readonly resolve: typeof resolveSelectedAiProvider;
  readonly consent: ExecutionConsentPort;
}) {
  const { choice, sourceId, lifetime, signal, resolve, consent } = input;
  if (choice.providerId !== APPLE_PCC_PROVIDER_ID) return null;
  const { isSettingsOnlyExecutionConsent } =
    require('../agent/execution/useInferenceConsent') as typeof import('../agent/execution/useInferenceConsent');
  if (!isSettingsOnlyExecutionConsent(consent)) return null;
  const { settingsConsentCredential } =
    require('../agent/execution/settingsConsentCredential') as typeof import('../agent/execution/settingsConsentCredential');
  const { resolveSettingsConsentTarget } =
    require('../agent/execution/settingsConsentOwner') as typeof import('../agent/execution/settingsConsentOwner');
  const { canReuseConsent, consentRevision } =
    require('../agent/execution/consentRevision') as typeof import('../agent/execution/consentRevision');
  const revision = consentRevision();
  const credential = await settingsConsentCredential(choice.providerId);
  const active = () =>
    !lifetime.aborted &&
    input.selectionCurrent() &&
    credential?.isCurrent() === true &&
    canReuseConsent() &&
    consentRevision() === revision;
  if (!active() || signal.aborted) return null;
  const selected = await resolve();
  if (
    !active() ||
    signal.aborted ||
    selected.status !== 'ready' ||
    !selected.remoteProcessing ||
    selected.option.privacyBoundary !== 'selected-context-remote' ||
    selected.provider.id !== choice.providerId ||
    selected.selection.providerId !== choice.providerId ||
    selected.selection.modelId !== choice.modelId ||
    selected.option.provider.id !== choice.providerId ||
    selected.option.modelId !== choice.modelId ||
    selected.modelId !== choice.modelId
  )
    return null;
  const target = {
    providerId: selected.provider.id,
    modelId: selected.modelId,
    recipient: selected.recipient,
  };
  const owner = await resolveSettingsConsentTarget(
    'conversation',
    'model',
    { ...target, signal: lifetime },
    'encounter_transcript_review',
  );
  if (
    !owner ||
    !active() ||
    signal.aborted ||
    owner.identity.credentialEpoch !== credential?.epoch
  )
    return null;
  const authority = bindRemoteEncounterPageAuthority({
    owner,
    target,
    sourceId,
    consent,
    active,
  });
  if (!authority) return null;
  return {
    isCurrent: authority.current,
    denied: authority.denied,
    subscribe(listener: () => void) {
      const stop = authority.subscribe(listener);
      const stopChoice = providerSelectionStore.subscribeChanges(listener);
      const stopCredential = credential?.subscribe(listener);
      return () => {
        stop();
        stopChoice();
        stopCredential?.();
      };
    },
    async extract(
      read: Parameters<typeof openLocalTranscriptPages>[0],
      executionId: string,
    ) {
      const pages = await openLocalTranscriptPages(read);
      return extractLocalTranscriptPages({
        sourceId,
        signal: read.signal,
        pages,
        selectionCurrent: authority.current,
        extract: encounterPageModel({
          sourceId,
          selected,
          consent: authority.port,
          executionId,
        }),
      });
    },
  };
}
