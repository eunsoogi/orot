import { AppText } from '../../layout/AppText';
import { t } from '../../i18n';
import type { SettingsConsentSlot } from '../../storage/settingsConsentStorage';

/** Settings owns continuing transmission consent; this copy is not an OS permission
 * or approval to search another recipient, write records, or send original photos. */
export function ModelSettingsConsentDisclosure({
  slot,
  recipient,
}: {
  readonly slot: SettingsConsentSlot;
  readonly recipient: string;
}) {
  return (
    <AppText testID="model-settings-transmission-disclosure">
      {t('modelSettings.consentRecipient', { recipient })}
      {'\n'}
      {t(
        slot === 'calendar'
          ? 'modelSettings.consentCalendarData'
          : slot === 'voice'
            ? 'modelSettings.consentVoiceData'
            : 'modelSettings.consentConversationData',
      )}
      {'\n'}
      {t('modelSettings.consentContinuing')}
    </AppText>
  );
}
