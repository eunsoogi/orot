import type { RecordingExportResult } from '../../src/recording/nativeRecordingBridge';

interface AudioExportProbePort {
  shareAudio(recordingId: string): Promise<RecordingExportResult>;
}

// Native export errors use fixed categories; do not echo arbitrary code strings that could carry private data.
const SAFE_AUDIO_EXPORT_REJECTION_CODES = new Set([
  'RECORDING_BUSY',
  'RECORDING_EXPORT_SOURCE_MISSING',
  'RECORDING_EXPORT_BUSY',
  'RECORDING_EXPORT_FAILED',
  'RECORDING_EXPORT_PROTECTION_NOT_APPLIED',
  'RECORDING_EXPORT_BACKUP_EXCLUSION_NOT_APPLIED',
  'RECORDING_EXPORT_UNAVAILABLE',
  'RECORDING_UNAVAILABLE',
]);

/** Keep probe diagnostics useful without logging arbitrary native error text or paths. */
export function formatAudioExportProbeDiagnostic(reason: unknown): string {
  let code: unknown;
  try {
    code =
      typeof reason === 'object' && reason !== null
        ? (reason as { code?: unknown }).code
        : undefined;
  } catch {
    code = undefined;
  }
  const safeCode =
    typeof code === 'string' && SAFE_AUDIO_EXPORT_REJECTION_CODES.has(code)
      ? code
      : 'unavailable';
  return `stage=audio-share-promise code=${safeCode}`;
}

/** Observe only rejected probe exports and restore the shared service on unmount. */
export function installAudioExportProbeDiagnostics(
  service: AudioExportProbePort,
  onDiagnostic: (diagnostic: string) => void,
  log: (message: string) => void = message => console.error(message),
): () => void {
  const originalShareAudio = service.shareAudio;
  const instrumentedShareAudio: AudioExportProbePort['shareAudio'] =
    async recordingId => {
      try {
        return await originalShareAudio(recordingId);
      } catch (reason) {
        const diagnostic = formatAudioExportProbeDiagnostic(reason);
        try {
          onDiagnostic(diagnostic);
          log(`RECORDING_EXPORT_PROBE_DIAGNOSTIC ${diagnostic}`);
        } catch {
          // Diagnostic output must not replace the original export rejection.
        }
        throw reason;
      }
    };
  service.shareAudio = instrumentedShareAudio;

  return () => {
    if (service.shareAudio === instrumentedShareAudio) {
      service.shareAudio = originalShareAudio;
    }
  };
}
