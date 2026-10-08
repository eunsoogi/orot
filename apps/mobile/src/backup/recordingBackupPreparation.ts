export type RecordingProtectionReadback = 'complete' | 'unverified' | 'unknown';

export type RecordingBackupPreparation =
  'ready' | 'simulator-protection-unverified';

// Classify the synthetic probe from explicit file-attribute evidence, not broad native-error catches.
export async function prepareRecordingBackup(
  protection: RecordingProtectionReadback,
  prepare: () => Promise<number>,
): Promise<RecordingBackupPreparation> {
  // Skip strict preparation only after the fixture explicitly reports unavailable Simulator metadata.
  if (protection === 'unverified') {
    return 'simulator-protection-unverified';
  }
  if (protection !== 'complete') {
    throw new Error('Recording protection is unknown.');
  }

  const count = await prepare();
  if (count !== 1) {
    throw new Error('The permanent recording count was unexpected.');
  }
  return 'ready';
}
