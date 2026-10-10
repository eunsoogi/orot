import { requireNativeModule } from './recordingNativeModule';
import type { RecordingExportResult } from './recordingNativeModule';

/** Keeps share actions and Simulator-only export probes outside the capture lifecycle bridge. */
export async function shareRecordingAudio(
  recordingId: string,
): Promise<RecordingExportResult> {
  const share = requireNativeModule().shareRecordingAudio;
  if (!share) {
    throw new Error('Recording audio export is unavailable on this platform.');
  }
  return share(recordingId);
}

export async function shareRecordingTranscript(
  text: string,
): Promise<RecordingExportResult> {
  const share = requireNativeModule().shareRecordingTranscript;
  if (!share) {
    throw new Error(
      'Recording transcript export is unavailable on this platform.',
    );
  }
  return share(text);
}

export async function prepareSyntheticExportResidue(): Promise<number> {
  const prepare = requireNativeModule().prepareSyntheticExportResidue;
  if (!prepare) {
    throw new Error('Synthetic export residue is unavailable in this build.');
  }
  return prepare();
}

export async function getSyntheticExportResidueCount(): Promise<number> {
  const getCount = requireNativeModule().getSyntheticExportResidueCount;
  if (!getCount) {
    throw new Error('Synthetic export residue is unavailable in this build.');
  }
  return getCount();
}

export async function armSyntheticExportCancellation(): Promise<void> {
  const arm = requireNativeModule().armSyntheticExportCancellation;
  if (!arm || !(await arm())) {
    throw new Error('The export cancellation probe could not be armed.');
  }
}
