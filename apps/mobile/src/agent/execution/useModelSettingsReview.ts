import { useEffect, useRef } from 'react';
import { t } from '../../i18n';
import { chatGPTCredentialMutation } from '../../providers/chatGPTConsentIdentity';
import { apiCredentialMutation } from '../../voiceSettings/voiceConsentIdentity';
import type { ProviderSelectionOption } from '../../providers/selection/types';
import type { SettingsSearchChoices } from './settingsSearchGrants';
import type { SettingsDisclosureSummary } from './settingsDisclosureSummary';
import { settingsConsentRecipient } from './settingsConsentRecipient';
import { useModelSettingsServices } from './ModelSettingsServices';
import type { ProviderSelectionStore } from '../../providers/selection/types';
import { useSettingsDisclosure } from './useSettingsDisclosure';

type Slot = 'conversation' | 'calendar';

function disclosureFor(
  slot: Slot,
  option: ProviderSelectionOption,
  search?: SettingsSearchChoices,
): SettingsDisclosureSummary | null {
  const remote = option.privacyBoundary === 'selected-context-remote';
  const recipient = remote
    ? settingsConsentRecipient(option.provider.id)
    : 'Europe PMC';
  if (!remote && !search?.medical) return null;
  if (!recipient) throw new Error('Unknown transmission recipient');
  const copy = remote
    ? [
        t(
          slot === 'calendar'
            ? 'modelSettings.consentCalendarData'
            : 'modelSettings.consentConversationData',
        ),
      ]
    : [];
  if (remote && search?.web) {
    copy.push(
      t('modelSettings.consentWeb', {
        recipient: t('externalMedicalEvidence.publicSearchRecipient', {
          recipient,
        }),
      }),
    );
  }
  if (search?.medical) copy.push(t('modelSettings.consentMedical'));
  return {
    providerId: remote ? option.provider.id : 'europe-pmc',
    modelId: remote ? option.modelId : 'public-medical-search',
    recipient,
    subtitle: t('medicalAppointments.inferenceDisclosure.title'),
    information: copy.join('\n'),
    notice: t('modelSettings.consentContinuing'),
  };
}

/** Ownership survives the native sheet, not a replaced account, hidden route or changed selection. No grants here. */
export function useModelSettingsReview(
  slot: Slot,
  enabled: boolean,
  owner: object,
  key: string,
  store: ProviderSelectionStore,
) {
  const { reuseApproval } = useModelSettingsServices();
  const { confirmDisclosure, disclosureSheet, cancelDisclosure } =
    useSettingsDisclosure();
  const latest = useRef({ owner, key });
  latest.current = { owner, key };
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
      cancelDisclosure();
    },
    [owner, key, cancelDisclosure],
  );

  const review = async (
    option: ProviderSelectionOption,
    search: SettingsSearchChoices | undefined,
    commit: (isCurrent: () => boolean) => Promise<void>,
  ) => {
    if (
      pending.current ||
      latest.current.owner !== owner ||
      latest.current.key !== key
    )
      return false;
    const credential = !enabled
      ? undefined
      : option.provider.id.startsWith('chatgpt-plan:')
        ? chatGPTCredentialMutation
        : option.provider.id === 'openai-api-decisions'
          ? apiCredentialMutation
          : undefined;
    const witness = credential ? credential.capture() : () => true;
    if (!witness) return false;
    const controller = new AbortController();
    pending.current = controller;
    const unsubscribe = credential?.subscribe(() => controller.abort());
    const current = () =>
      latest.current.owner === owner &&
      latest.current.key === key &&
      pending.current === controller &&
      !controller.signal.aborted &&
      witness();
    try {
      const disclosure = enabled && disclosureFor(slot, option, search);
      if (
        disclosure &&
        (await reuseApproval?.(
          {
            slot,
            option,
            search,
            signal: controller.signal,
            isCurrent: current,
          },
          store,
        ))
      )
        return current();
      if (
        disclosure &&
        !(await confirmDisclosure(disclosure, controller.signal))
      )
        return false;
      if (!current()) return false;
      await commit(current);
      return current();
    } finally {
      if (pending.current === controller) pending.current = null;
      unsubscribe?.();
    }
  };
  return {
    review,
    disclosureSheet,
    isReviewing: () => pending.current !== null,
  };
}
