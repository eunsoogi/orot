import { t } from '../../i18n';
import type { CalendarEvent } from '../../calendar/types';
import type { UnifiedEventKitProgress } from './types';

/** Preserves provider-specific access outcomes and occurrence identity in the selection UI. */
export function statusMessage(progress: UnifiedEventKitProgress): string {
  switch (progress.status) {
    case 'notSelected':
      return '';
    case 'waitingAuthorization':
    case 'authorizing':
    case 'ready':
    case 'querying':
    case 'fullAccess':
      return t('calendar.loading');
    case 'complete':
      return t('calendar.candidateHint');
    case 'empty':
      return t('calendar.empty');
    case 'denied':
      return t('calendar.accessDenied');
    case 'restricted':
      return t('calendar.accessRestricted');
    case 'writeOnly':
      return t('calendar.fullAccessRequired');
    case 'notDetermined':
      return t('calendar.tryAgainAfterPermission');
    case 'cancelled':
      return t('healthkit.unifiedImport.eventKitCancelled');
    case 'failed':
      return t('calendar.loadError');
  }
}

export function candidateKey(event: CalendarEvent): string {
  const snapshot = event.calendarEventSnapshot;
  return `${event.calendarEventIdentifier}\u0000${snapshot.occurrenceDate ?? snapshot.floatingOccurrenceAt ?? event.effectiveAt}`;
}
