import { t } from '../i18n';
import type { RecordingStatus } from './recordingTypes';

/** Maps persisted recorder states to the Korean labels shown in the controls. */
export function recordingStatusLabel(status: RecordingStatus): string {
  switch (status) {
    case 'idle':
      return t('recording.status.idle');
    case 'recording':
      return t('recording.status.recording');
    case 'paused':
      return t('recording.status.paused');
    case 'interrupted':
      return t('recording.status.interrupted');
    case 'completed':
      return t('recording.status.completed');
  }
}
