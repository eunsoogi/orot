import { t } from '../i18n';

/** Converts native recording failures to user-facing messages without exposing platform details. */
export function errorMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'RECORDING_CONSENT_REQUIRED')
    return t('recording.errors.consent');
  if (code === 'RECORDING_MICROPHONE_PERMISSION_DENIED') {
    return t('recording.errors.microphonePermission');
  }
  if (code === 'RECORDING_FILE_PROTECTION_FAILED') {
    return t('recording.errors.fileProtection');
  }
  return t('recording.errors.generic');
}

/** Keeps an already-captured audio file available when its metadata link needs retry. */
export function sourceSaveErrorMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'RECORDING_FILE_PROTECTION_FAILED'
    ? errorMessage(error)
    : t('recording.errors.sourceSave');
}
