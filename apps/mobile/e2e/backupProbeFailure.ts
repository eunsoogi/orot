/** Report fixed synthetic failure categories without exposing native paths, Keychain bytes or arbitrary error text. */
export function backupProbeFailureReason(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'STORAGE_OPEN_FAILED') return 'storage-open-failed';
  if (code === 'RECORDING_FILE_PROTECTION_FAILED')
    return 'recording-protection-failed';
  const message = error instanceof Error ? error.message : '';
  const categories: Record<string, string> = {
    'invalid-recording-id': 'invalid-recording-id',
    'recording-not-found': 'recording-not-found',
    'backup-exclusion-not-readable': 'backup-exclusion-not-readable',
    'unclassified-native-failure': 'unclassified-native-failure',
    'The dedicated backup-probe bridge is unavailable.':
      'probe-bridge-unavailable',
    'The synthetic recording is unreadable or backup-excluded.':
      'recording-state-invalid',
    'The legacy recording did not start backup-excluded.':
      'legacy-exclusion-missing',
    'The prepared recording source or transcript was not persisted.':
      'recording-relationships-missing',
    'An unverified recording source bypassed the fail-closed persistence gate.':
      'unverified-recording-persisted',
    'Legacy recording backup preparation failed outside the Simulator protection-metadata limit.':
      'legacy-preparation-failed',
  };
  return Object.hasOwn(categories, message)
    ? categories[message]!
    : 'unclassified-probe-failure';
}
