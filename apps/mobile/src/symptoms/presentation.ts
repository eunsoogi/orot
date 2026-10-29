import type { SymptomEntry } from '@orot/storage';
import { formatDateTime, t } from '../i18n';

/** Maps existing domain states and UTC instants to Korean, device-local labels. */
export function symptomStatusLabel(status: SymptomEntry['status']): string {
  return t(
    status === 'active'
      ? 'symptoms.journal.status.active'
      : 'symptoms.journal.status.resolved',
  );
}

/** Formats a stored instant in the device time zone without exposing its raw value. */
export function symptomDateTimeLabel(timestamp: string): string {
  return t('symptoms.journal.localDateTime', {
    dateTime: formatDateTime(new Date(timestamp)),
  });
}
