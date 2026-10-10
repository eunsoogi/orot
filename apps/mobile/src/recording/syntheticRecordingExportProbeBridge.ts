import { NativeModules } from 'react-native';

export interface SyntheticRecordingExportAuthorizationReport {
  readonly registeredFixtureAllowed: boolean;
  readonly missingIDRejected: boolean;
  readonly unregisteredFileUsesStrictPath: boolean;
  readonly discardedRegistrationUsesStrictPath: boolean;
  readonly backupExclusionStillRequired: boolean;
}

interface NativeRecordingExportProbeModule {
  isSyntheticTranscriptionFixtureUnchanged?: (
    recordingId: string,
  ) => Promise<boolean>;
  verifySyntheticRecordingExportAuthorization?: (
    recordingId: string,
  ) => Promise<SyntheticRecordingExportAuthorizationReport>;
}

function requireNativeProbeModule(): NativeRecordingExportProbeModule {
  const module = NativeModules.RecordingModule as
    NativeRecordingExportProbeModule | undefined;
  if (!module) throw new Error('The Simulator recording probe is unavailable.');
  return module;
}

// These readbacks are exposed only to the dedicated synthetic Simulator probe UI.
export async function isSyntheticTranscriptionFixtureUnchanged(
  recordingId: string,
): Promise<boolean> {
  const check =
    requireNativeProbeModule().isSyntheticTranscriptionFixtureUnchanged;
  if (!check) throw new Error('Synthetic fixture check is unavailable.');
  return check(recordingId);
}

export async function verifySyntheticRecordingExportAuthorization(
  recordingId: string,
): Promise<SyntheticRecordingExportAuthorizationReport> {
  const verify =
    requireNativeProbeModule().verifySyntheticRecordingExportAuthorization;
  if (!verify)
    throw new Error('Synthetic export guard checks are unavailable.');
  return verify(recordingId);
}
