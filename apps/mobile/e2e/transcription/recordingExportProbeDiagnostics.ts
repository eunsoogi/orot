import type { RecordingExportResult } from '../../src/recording/nativeRecordingBridge';

interface AudioExportProbePort {
  shareAudio(recordingId: string): Promise<RecordingExportResult>;
}

const SAFE_REJECTION_CODE = /^[A-Z0-9_]{1,64}$/;

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
    typeof code === 'string' && SAFE_REJECTION_CODE.test(code)
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
