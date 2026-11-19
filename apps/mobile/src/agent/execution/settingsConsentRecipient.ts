import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { APPLE_PCC_PROVIDER_ID } from '../../providers/selection/privateCloudCompute';
import { t } from '../../i18n';

/** Recipient names match outbound request builders; unknown providers cannot acquire a grant. */
export function settingsConsentRecipient(providerId: string): string | null {
  if (providerId === APPLE_PROVIDER_ID)
    return t('nextVisit.recipient.onDevice');
  if (providerId === APPLE_PCC_PROVIDER_ID) return t('provider.pcc.recipient');
  if (providerId.startsWith('chatgpt-plan:'))
    return t('nextVisit.recipient.chatgpt');
  if (providerId === 'openai-api-decisions') return 'OpenAI API';
  if (providerId === 'openai-realtime') return 'OpenAI Realtime API';
  return null;
}
