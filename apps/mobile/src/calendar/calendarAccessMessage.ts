import { t } from '../i18n';
import type { CalendarAccessState } from './types';

/** Explains the access state without claiming full Calendar permission. */
export function calendarAccessMessage(
  access: CalendarAccessState | null,
): string {
  if (access === 'denied') return t('calendar.accessDenied');
  if (access === 'restricted') return t('calendar.accessRestricted');
  if (access === 'writeOnly') return t('calendar.fullAccessRequired');
  if (access === 'notDetermined') return t('calendar.tryAgainAfterPermission');
  return '';
}
