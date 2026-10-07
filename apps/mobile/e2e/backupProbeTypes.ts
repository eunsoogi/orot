// Result data stays synthetic and never includes the database key bytes.
export type BackupProbeMode =
  | 'seed'
  | 'recover'
  | 'legacy-recording'
  | 'rollback'
  | 'rollback-recover'
  | 'snapshot-seed'
  | 'snapshot-recover';

export type ProbeFileProtection = 'complete' | 'unverified' | 'not-complete';

export interface RecordingProbeState {
  readonly fileProtection: ProbeFileProtection;
  readonly excludedFromBackup: boolean;
  readonly fileReadable: boolean;
}

export interface LegacyRecordingProbeState extends RecordingProbeState {
  readonly legacyExcludedBefore: boolean;
  readonly preparedCount: number;
  readonly preparationError: string;
  readonly preparationReady: boolean;
}

export interface NativeBackupProbeModule {
  armPostUpdateReadbackFailureForProbe(): Promise<boolean>;
  postUpdateReadbackFailureWasTriggeredForProbe(): Promise<boolean>;
  prepareLegacyRecordingForBackupProbe(
    recordingId: string,
  ): Promise<LegacyRecordingProbeState>;
  inspectRecordingForBackupProbe(
    recordingId: string,
  ): Promise<RecordingProbeState>;
  backupKeyAccessibilityForProbe(): Promise<string>;
}

export interface BackupProbeResult {
  readonly evidenceScope?:
    | 'synthetic-simulator-process-restart'
    | 'synthetic-simulator-app-container-snapshot';
  readonly keyMigration?: string;
  readonly keyPreserved?: boolean;
  readonly keyEligible?: boolean;
  readonly storageRelationsReopened?: boolean;
  readonly agentMemoryTombstonePreserved?: boolean;
  readonly recording?: {
    readonly fileProtection: string;
    readonly excludedFromBackup: boolean;
    readonly strictPreparation: string;
    readonly sourcePersisted: boolean;
    readonly recordingId?: string;
    readonly legacyExcludedBefore?: boolean;
    readonly preparedCount?: number;
    readonly preparationError?: string;
    readonly preparationReady?: boolean;
    readonly fileReadable?: boolean;
    readonly transcriptLinked?: boolean;
    readonly sourceFixture?: string;
  };
  readonly rollbackVerified?: boolean;
  readonly keyAccessibility?: string;
}
