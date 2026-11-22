import { resolveCalendarModel } from '../../calendarModelSettings/resolveCalendarModel';
import { calendarModelStore } from '../../calendarModelSettings/calendarModelStore';
import { providerSelectionStore } from '../../providers/selection/keychainSelectionStore';
import { chatGPTCredentialMutation } from '../../providers/chatGPTConsentIdentity';
import { apiCredentialMutation } from '../../voiceSettings/voiceConsentIdentity';
import { settingsConsentAuthority } from '../../storage/settingsConsentAuthority';
import { settingsConsentRepository } from '../../storage/settingsConsentRepository';
import type { ProviderSelectionOption } from '../../providers/selection/types';
import { alreadyApprovedModelSettings } from './alreadyApprovedModelSettings';
import { productionSettingsConsentReadServices } from './SettingsConsentReadServices';
import { settingsConsentCredential } from './settingsConsentCredential';
import { settingsConsentRecipient } from './settingsConsentRecipient';
import {
  SETTINGS_CONSENT_CATALOG_VERSION,
  settingsPermissionsForFeature,
} from './settingsConsentCatalog';
import {
  settingsSearchGrants,
  type SettingsSearchChoices,
} from './settingsSearchGrants';
import { commitJointExistingModelConsent } from './jointExistingModelConsent';
import { canReuseConsent, consentRevision } from './consentRevision';

export interface JointCalendarReview {
  readonly calendarRecipient: string;
  readonly calendarModel: string;
  readonly isCurrent: () => boolean;
  readonly alreadyApproved: () => Promise<boolean>;
  readonly commit: () => Promise<void>;
}

/** Add Calendar only to a review for a known already selected remote calendar owner.
 * A new conversation choice is staged only after the same explicit review.
 * Unknown devices, credentials and destinations cannot participate. Read-only
 * preparation deliberately does not require a previous Calendar grant. */
export async function prepareJointCalendarReview(
  option: ProviderSelectionOption,
  search: SettingsSearchChoices | undefined,
  signal: AbortSignal,
  requestCurrent: () => boolean,
): Promise<JointCalendarReview | null> {
  if (option.privacyBoundary !== 'selected-context-remote') return null;
  const calendarSelection = calendarModelStore.liveWitness();
  const originalSelectionWitness = providerSelectionStore.liveWitness();
  const api = apiCredentialMutation.capture();
  const chat = chatGPTCredentialMutation.capture();
  if (!calendarSelection || !originalSelectionWitness) return null;
  let conversationSelection = originalSelectionWitness;
  const revision = consentRevision();
  const outsideConversationSelection = () =>
    !signal.aborted &&
    requestCurrent() &&
    canReuseConsent() &&
    consentRevision() === revision &&
    calendarSelection();
  const current = () =>
    outsideConversationSelection() && conversationSelection();
  if (!current()) return null;
  const prior = await providerSelectionStore.load();
  const choice = { providerId: option.provider.id, modelId: option.modelId };
  const changesSelection =
    prior?.providerId !== choice.providerId || prior.modelId !== choice.modelId;
  const conversationRecipient = settingsConsentRecipient(choice.providerId);
  const calendar = await resolveCalendarModel();
  if (
    !conversationRecipient ||
    calendar?.status !== 'ready' ||
    !calendar.remoteProcessing ||
    !current()
  )
    return null;
  const calendarRecipient = settingsConsentRecipient(calendar.provider.id);
  if (!calendarRecipient || calendarRecipient !== calendar.recipient)
    return null;
  const ownsCredential = (id: string) =>
    id.startsWith('chatgpt-plan:')
      ? chat
      : id === 'openai-api-decisions'
        ? api
        : undefined;
  const calendarOwner = ownsCredential(calendar.provider.id);
  const conversationOwner = ownsCredential(choice.providerId);
  if (!calendarOwner?.() || !conversationOwner?.()) return null;
  const initial = () => current() && calendarOwner() && conversationOwner();
  return {
    calendarRecipient,
    calendarModel: calendar.modelId,
    isCurrent: initial,
    alreadyApproved: () =>
      alreadyApprovedModelSettings({
        services: productionSettingsConsentReadServices,
        slot: 'calendar',
        option: calendar.option,
        signal,
        isCurrent: initial,
      }),
    async commit() {
      if (!initial()) throw new Error('Joint permission owner changed');
      // First-time legacy epochs may be created only after the explicit joint review.
      const calendarCredential = await settingsConsentCredential(
        calendar.provider.id,
        true,
      );
      const conversationCredential = await settingsConsentCredential(
        choice.providerId,
        true,
      );
      if (!calendarCredential || !conversationCredential || !initial())
        throw new Error('Joint permission owner changed');
      const storage = await settingsConsentRepository();
      await commitJointExistingModelConsent(
        [
          {
            slot: 'conversation',
            authority: settingsConsentAuthority('conversation'),
            ownerCurrent: () =>
              conversationOwner() &&
              conversationSelection() &&
              conversationCredential.isCurrent(),
            grants: generation => {
              const identity = {
                ...choice,
                recipient: conversationRecipient,
                authorityGeneration: generation,
                credentialEpoch: conversationCredential.epoch,
              };
              return [
                {
                  domain: 'model',
                  grant: {
                    version: 1,
                    catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
                    identity,
                    permissions: settingsPermissionsForFeature(
                      'conversation',
                      choice.providerId,
                    ),
                  },
                },
                ...settingsSearchGrants(identity, search),
              ];
            },
          },
          {
            slot: 'calendar',
            authority: settingsConsentAuthority('calendar'),
            ownerCurrent: () =>
              calendarOwner() &&
              calendarSelection() &&
              calendarCredential.isCurrent(),
            grants: generation => [
              {
                domain: 'model',
                grant: {
                  version: 1,
                  catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
                  identity: {
                    providerId: calendar.provider.id,
                    modelId: calendar.modelId,
                    recipient: calendarRecipient,
                    authorityGeneration: generation,
                    credentialEpoch: calendarCredential.epoch,
                  },
                  permissions: settingsPermissionsForFeature(
                    'calendar',
                    calendar.provider.id,
                  ),
                },
              },
            ],
          },
        ],
        storage,
        outsideConversationSelection,
        changesSelection
          ? {
              stage: async () => {
                const witness = await providerSelectionStore.replaceOwned(
                  prior,
                  choice,
                  originalSelectionWitness,
                  () =>
                    outsideConversationSelection() &&
                    conversationOwner() &&
                    calendarOwner(),
                );
                if (!witness) return false;
                conversationSelection = witness;
                return witness();
              },
              compensate: async () => {
                if (conversationSelection === originalSelectionWitness) return;
                // No other writer may be displaced; rollback is never an approval.
                await providerSelectionStore.replaceOwned(
                  choice,
                  prior,
                  conversationSelection,
                  () => true,
                );
              },
            }
          : undefined,
      );
    },
  };
}
