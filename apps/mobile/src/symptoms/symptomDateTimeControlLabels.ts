import { t } from '../i18n';
import { toLocalSymptomDateTime, toSymptomTimestamp } from './dateTime';

/** Labels use Korean calendar copy and device wall time, while invalid manual input stays visible. */
export function symptomDateTimeControlLabels(date: string, time: string) {
  const timestamp = toSymptomTimestamp(date, time);
  if (!timestamp)
    return {
      date: date || t('symptoms.journal.form.chooseDate'),
      time: time || t('symptoms.journal.form.chooseTime'),
    };
  const value = new Date(timestamp);
  return {
    date:
      date === toLocalSymptomDateTime(new Date().toISOString()).date
        ? t('symptoms.journal.today')
        : new Intl.DateTimeFormat('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }).format(value),
    time: new Intl.DateTimeFormat('ko-KR', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(value),
  };
}
