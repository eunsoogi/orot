import type {
  LegacyRecordingProbeState,
  RecordingProbeState,
} from './backupProbeTypes';

// Only the dedicated Simulator's unavailable protection readback is an expected negative result.
export function isExpectedProtectionMetadataGap(
  result: Pick<
    LegacyRecordingProbeState,
    'fileProtection' | 'preparationError' | 'preparedCount' | 'preparationReady'
  >,
): boolean {
  return (
    result.fileProtection === 'unverified' &&
    result.preparationError === 'protection-not-applied' &&
    result.preparedCount === 0 &&
    !result.preparationReady
  );
}

// Probe recordings must remain readable and outside the temporary-file boundary.
export function verifyRecordingProbeState(state: RecordingProbeState): void {
  if (!state.fileReadable || state.excludedFromBackup) {
    throw new Error(
      'The synthetic recording is unreadable or backup-excluded.',
    );
  }
}
