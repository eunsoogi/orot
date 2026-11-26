import { canDiscloseDirectPhoto } from './directPhotoConsentScope';
import type { JointCalendarReview } from './prepareJointCalendarReview';
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
import { conversationTransmissionCopy } from './conversationTransmissionDisclosure';

type Slot = 'conversation' | 'calendar';

function disclosureFor(
  slot: Slot,
  option: ProviderSelectionOption,
  search: SettingsSearchChoices | undefined,
  calendar: JointCalendarReview | undefined,
  photoDisclosed: boolean,
): SettingsDisclosureSummary | null {
  const remote = option.privacyBoundary === 'selected-context-remote';
  const recipient = remote
    ? settingsConsentRecipient(option.provider.id)
    : 'Europe PMC';
  if (!remote && !search?.medical) return null;
  if (!recipient) throw new Error('Unknown transmission recipient');
  const copy = remote
    ? [
        slot === 'calendar'
          ? t('modelSettings.consentCalendarData')
          : conversationTransmissionCopy('conversation').information,
      ]
    : [];
  if (photoDisclosed)
    copy.push(
      t('ragConversation.photo.imageSettingsConsent', {
        recipient,
        model: option.displayName,
      }),
    );
  const jointWeb = slot === 'conversation' && remote && search?.web;
  if (jointWeb) {
    copy.push(t('modelSettings.consentJointWeb', { recipient }));
  }
  if (calendar)
    copy.push(
      t('modelSettings.consentJointCalendar', {
        recipient: calendar.calendarRecipient,
        model: calendar.calendarModel,
      }),
    );
  if (search?.medical) copy.push(t('modelSettings.consentJointMedical'));
  return {
    providerId: remote ? option.provider.id : 'europe-pmc',
    modelId: remote ? option.modelId : 'public-medical-search',
    recipient,
    subtitle: calendar
      ? t(
          jointWeb || search?.medical
            ? 'modelSettings.consentJointCalendarWebTitle'
            : 'modelSettings.consentJointCalendarTitle',
        )
      : search?.medical
        ? t(
            remote
              ? 'modelSettings.consentJointConversationMedicalTitle'
              : 'modelSettings.consentMedicalTitle',
          )
        : jointWeb
          ? t('modelSettings.consentJointConversationWebTitle')
          : t('medicalAppointments.inferenceDisclosure.title'),
    information: copy.join('\n'),
    notice: conversationTransmissionCopy('conversation').notice,
  };
}

/** Ownership survives the native sheet, not a replaced account, hidden route or changed selection. No grants here. */
export function useModelSettingsReview(
  slot: Slot,
  enabled: boolean,
  owner: object,
  key: string,
  store: ProviderSelectionStore,
  settingsPhotoReview = false,
) {
  const { reuseApproval, prepareJointCalendarReview } =
    useModelSettingsServices();
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
    commit: (isCurrent: () => boolean, reviewedPhoto?: true) => Promise<void>,
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
      const calendar =
        enabled && slot === 'conversation'
          ? await prepareJointCalendarReview?.(
              option,
              search,
              controller.signal,
              current,
              store,
            )
          : null;
      if (!current() || (calendar && !calendar.isCurrent())) return false;
      const photoDisclosed =
        enabled &&
        settingsPhotoReview &&
        slot === 'conversation' &&
        canDiscloseDirectPhoto(option);
      const disclosure =
        enabled &&
        disclosureFor(
          slot,
          option,
          search,
          calendar ?? undefined,
          photoDisclosed,
        );
      if (
        disclosure &&
        (await reuseApproval?.(
          {
            slot,
            option,
            search,
            photoDisclosed,
            signal: controller.signal,
            isCurrent: current,
          },
          store,
        )) &&
        (!calendar || (await calendar.alreadyApproved()))
      )
        return current() && (!calendar || calendar.isCurrent());
      if (
        disclosure &&
        !(await confirmDisclosure(disclosure, controller.signal))
      )
        return false;
      if (!current() || (calendar && !calendar.isCurrent())) return false;
      const reviewedPhoto = Boolean(
        disclosure && photoDisclosed && canDiscloseDirectPhoto(option),
      );
      if (calendar) {
        if (reviewedPhoto) await calendar.commit(true);
        else await calendar.commit();
      } else if (reviewedPhoto) await commit(current, true);
      else await commit(current);
      // The joint writer already settled; a later Calendar-only change must not strand the Conversation picker.
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
