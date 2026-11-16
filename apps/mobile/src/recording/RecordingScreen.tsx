import type { RecordingScreenProps } from './recordingScreenProps';
import { useEffect, useRef, useState } from 'react';
import RecordingControls from './RecordingControls';
import {
  clearPendingRecordingRetry,
  getPendingRecordingRetry,
  setPendingRecordingRetry,
} from './recordingRetryState';
import { recordingService } from './recordingService';
import type { CompletedRecording, RecordingSnapshot } from './recordingTypes';
import { recordingLibraryService as defaultRecordingLibraryService } from './recordingLibraryService';
import { errorMessage, sourceSaveErrorMessage } from './recordingErrors';
import { useAutomaticRecordingTranscription } from './useAutomaticRecordingTranscription';
import { useRecordingScreenProbeActions } from './useRecordingScreenProbeActions';
import { RecordingDeletionTimingContext } from './recordingDeletionTiming';
import { type AutomaticRecordingVisit } from './automaticRecordingVisit';
import {
  bindAutomaticRecordingVisit,
  selectRecordingVisitWithinDeadline,
} from './bindAutomaticRecordingVisit';
import { initialRecordingSnapshot } from './initialRecordingSnapshot';

export default function RecordingScreen({
  onBack,
  onOpenSavedRecordings,
  service = recordingService,
  playbackService = service,
  transcriptService,
  recordingLibraryService = defaultRecordingLibraryService,
  recordingDeletionTimingProbe,
}: RecordingScreenProps) {
  const [snapshot, setSnapshot] = useState(initialRecordingSnapshot);
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
  const automaticTranscription =
    useAutomaticRecordingTranscription(transcriptService);
  const visit = useRef<AutomaticRecordingVisit | null>(null);
  const generation = useRef(0);
  const probeActions = useRecordingScreenProbeActions();

  useEffect(() => {
    generation.current += 1;
    visit.current = null;
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
      generation.current += 1;
      visit.current = null;
      unsubscribe();
    };
  }, [service]);

  async function runAction(
    action: () => Promise<RecordingSnapshot | undefined>,
  ) {
    setBusy(true);
    setError('');
    try {
      const next = await action();
      if (!next) return;
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
      const owner = generation.current;
      // Capture one start-time candidate; a later appointment never silently replaces this take's visit.
      const candidate = await selectRecordingVisitWithinDeadline(
        new Date().toISOString(),
      );
      if (owner !== generation.current) return;
      const next = await service.start(consentAcknowledged);
      visit.current = candidate;
      clearPendingRecordingRetry(service);
      setLastRecording(null);
      setSourceSaved(false);
      automaticTranscription.reset();
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
        await bindAutomaticRecordingVisit(result.id, visit.current);
        clearPendingRecordingRetry(service);
        setSourceSaved(true);
        automaticTranscription.start(result.id);
      } catch (reason) {
        setSourceSaved(false);
        setError(sourceSaveErrorMessage(reason));
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      probeActions.clear();
      setBusy(false);
    }
  }

  async function retrySourceSave() {
    if (!lastRecording) return;
    setBusy(true);
    setError('');
    try {
      await service.saveSource(lastRecording);
      await bindAutomaticRecordingVisit(lastRecording.id, visit.current);
      clearPendingRecordingRetry(service);
      setSourceSaved(true);
      automaticTranscription.start(lastRecording.id);
    } catch (reason) {
      setError(sourceSaveErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  function retryTranscription(): void {
    const sourceId = automaticTranscription.state?.sourceId;
    if (sourceId) automaticTranscription.start(sourceId);
  }

  function handleRecordingSourceDeleted(sourceId: string): void {
    automaticTranscription.cancel(sourceId);
    if (lastRecording?.id !== sourceId) return;
    // Clear the retry snapshot too, so a deleted file cannot return through metadata retry after remount.
    clearPendingRecordingRetry(service);
    setLastRecording(null);
    setSourceSaved(false);
    setSnapshot(initialRecordingSnapshot);
    setConsentAcknowledged(false);
  }

  return (
    <RecordingDeletionTimingContext.Provider
      value={recordingDeletionTimingProbe ?? null}
    >
      <RecordingControls
        onOpenSavedRecordings={onOpenSavedRecordings}
        onBack={onBack}
        stateReady={stateReady}
        status={snapshot.status}
        durationMs={snapshot.durationMs}
        amplitude={snapshot.amplitude}
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
        syntheticProbeAvailable={probeActions.available}
        syntheticProbeReady={probeActions.ready}
        onPrepareSyntheticProbe={probeActions.prepare}
        onPrepareSyntheticStartFailure={probeActions.prepareStartFailure}
        onSendInterruption={probeActions.sendInterruption}
        probeError={probeActions.error}
        transcriptService={transcriptService}
        playbackService={playbackService}
        recordingLibraryService={recordingLibraryService}
        automaticTranscription={automaticTranscription.state}
        onRetryTranscription={retryTranscription}
        onRecordingSourceDeleted={handleRecordingSourceDeleted}
      />
    </RecordingDeletionTimingContext.Provider>
  );
}
