import { useEffect, useState } from 'react';
import RecordingControls from './RecordingControls';
import { t } from '../i18n';
import {
  isSyntheticRecordingProbeAvailable,
  prepareSyntheticRecordingProbe,
  prepareSyntheticRecordingStartFailure,
  simulateRecordingInterruption,
} from './nativeRecordingBridge';
import {
  clearPendingRecordingRetry,
  getPendingRecordingRetry,
  setPendingRecordingRetry,
} from './recordingRetryState';
import { recordingService } from './recordingService';
import type {
  CompletedRecording,
  RecordingService,
  RecordingSnapshot,
} from './recordingTypes';
import type { TranscriptEvidenceService } from '../transcription/transcriptEvidenceService';

interface RecordingScreenProps {
  onBack: () => void;
  service?: RecordingService;
  /** Lets the Simulator probe exercise the production screen with synthetic playback evidence. */
  transcriptService?: TranscriptEvidenceService;
}

const initialSnapshot: RecordingSnapshot = {
  status: 'idle',
  id: null,
  durationMs: 0,
  consentAcknowledged: false,
};

function errorMessage(error: unknown): string {
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

function sourceSaveErrorMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'RECORDING_FILE_PROTECTION_FAILED'
    ? errorMessage(error)
    : t('recording.errors.sourceSave');
}

export default function RecordingScreen({
  onBack,
  service = recordingService,
  transcriptService,
}: RecordingScreenProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [stateReady, setStateReady] = useState(false);
  const [consentAcknowledged, setConsentAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lastRecording, setLastRecording] = useState<CompletedRecording | null>(
    () => getPendingRecordingRetry(service),
  );
  const [sourceSaved, setSourceSaved] = useState(
    () => getPendingRecordingRetry(service) === null,
  );
  const [syntheticProbeReady, setSyntheticProbeReady] = useState(false);
  const [probeError, setProbeError] = useState('');
  const syntheticProbeAvailable = isSyntheticRecordingProbeAvailable();

  useEffect(() => {
    let mounted = true;
    let unsubscribe: () => void = () => {};
    const pendingRetry = getPendingRecordingRetry(service);
    setLastRecording(pendingRetry);
    setSourceSaved(pendingRetry === null);
    try {
      unsubscribe = service.subscribe(value => {
        if (mounted) {
          setSnapshot(value);
          setConsentAcknowledged(value.consentAcknowledged);
          setStateReady(true);
        }
      });
      service
        .getState()
        .then(value => {
          if (mounted) {
            setSnapshot(value);
            setConsentAcknowledged(value.consentAcknowledged);
            setStateReady(true);
          }
        })
        .catch(reason => {
          if (mounted) {
            setError(errorMessage(reason));
            setStateReady(true);
          }
        });
    } catch (reason) {
      setError(errorMessage(reason));
      setStateReady(true);
    }

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [service]);

  async function runAction(action: () => Promise<RecordingSnapshot>) {
    setBusy(true);
    setError('');
    try {
      const next = await action();
      setSnapshot(next);
      setConsentAcknowledged(next.consentAcknowledged);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    await runAction(async () => {
      const next = await service.start(consentAcknowledged);
      clearPendingRecordingRetry(service);
      setLastRecording(null);
      setSourceSaved(false);
      return next;
    });
  }

  async function stop() {
    setBusy(true);
    setError('');
    try {
      const result = await service.stop();
      setLastRecording(result);
      // Keep metadata retries only after both permanent-file checks are verified.
      const backupEligible = result.excludedFromBackup === false;
      if (result.fileProtection === 'complete' && backupEligible) {
        setPendingRecordingRetry(service, result);
      } else {
        clearPendingRecordingRetry(service);
      }
      setSnapshot({
        status: 'completed',
        id: result.id,
        durationMs: result.durationMs,
        consentAcknowledged: false,
      });
      setConsentAcknowledged(false);
      try {
        await service.saveSource(result);
        clearPendingRecordingRetry(service);
        setSourceSaved(true);
      } catch (reason) {
        setSourceSaved(false);
        setError(sourceSaveErrorMessage(reason));
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSyntheticProbeReady(false);
      setBusy(false);
    }
  }

  async function retrySourceSave() {
    if (!lastRecording) return;
    setBusy(true);
    setError('');
    try {
      await service.saveSource(lastRecording);
      clearPendingRecordingRetry(service);
      setSourceSaved(true);
    } catch (reason) {
      setError(sourceSaveErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function prepareSyntheticProbe() {
    setProbeError('');
    try {
      await prepareSyntheticRecordingProbe();
      setSyntheticProbeReady(true);
    } catch {
      setProbeError(t('recording.errors.generic'));
    }
  }

  async function prepareSyntheticStartFailure(
    point: 'beforeFileURL' | 'afterFileCreated',
  ) {
    setProbeError('');
    try {
      await prepareSyntheticRecordingStartFailure(point);
      setSyntheticProbeReady(true);
    } catch {
      setProbeError(t('recording.errors.generic'));
    }
  }

  async function sendInterruption(phase: 'began' | 'ended') {
    setProbeError('');
    try {
      await simulateRecordingInterruption(phase);
    } catch {
      setProbeError(t('recording.errors.generic'));
    }
  }

  return (
    <RecordingControls
      onBack={onBack}
      stateReady={stateReady}
      status={snapshot.status}
      durationMs={snapshot.durationMs}
      consentAcknowledged={consentAcknowledged}
      onToggleConsent={() => setConsentAcknowledged(value => !value)}
      busy={busy}
      onStart={start}
      onPause={() => runAction(() => service.pause())}
      onResume={() => runAction(() => service.resume())}
      onStop={stop}
      lastRecording={lastRecording}
      sourceSaved={sourceSaved}
      onRetrySourceSave={retrySourceSave}
      error={error}
      syntheticProbeAvailable={syntheticProbeAvailable}
      syntheticProbeReady={syntheticProbeReady}
      onPrepareSyntheticProbe={prepareSyntheticProbe}
      onPrepareSyntheticStartFailure={prepareSyntheticStartFailure}
      onSendInterruption={sendInterruption}
      probeError={probeError}
      transcriptService={transcriptService}
    />
  );
}
