import { t } from '../../i18n';

/** Both selected model routes reuse the Settings review, not an in-call prompt.
 * The disclosure names only the data groups this recipient can receive. */
export function conversationTransmissionCopy(
  scope: 'conversation' | 'live-local-tools',
) {
  const live = scope === 'live-local-tools';
  return {
    subtitle: t('medicalAppointments.inferenceDisclosure.title'),
    information: t(
      live
        ? 'modelSettings.liveConversationToolsTransmission'
        : 'modelSettings.consentConversationData',
    ),
    notice: [
      t('modelSettings.consentContinuing'),
      ...(live ? [t('modelSettings.liveResponsesConsentNotice')] : []),
    ].join('\n'),
  };
}
