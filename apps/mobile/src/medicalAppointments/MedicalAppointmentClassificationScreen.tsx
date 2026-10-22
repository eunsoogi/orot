import { useEffect, useRef, useState } from 'react';
import type { AppointmentRepository } from '@orot/storage';
import { useInferenceConsent } from '../agent/execution/useInferenceConsent';
import type { ProviderSelectionOption } from '../providers/selection/types';
import { medicalAppointmentCopy as copy } from './copy.ko';
import { classifyCalendarEvents } from './classificationWorkflow';
import { classificationFailureMessage } from './classificationFailure';
import type { CandidateReview } from './classificationWorkflow';
import type { CalendarBridge } from '../calendar/types';
import type { CalendarAutoSyncState } from '../calendar/calendarAutoSync';
import { MedicalAppointmentReviewView } from './MedicalAppointmentReviewView';
import {
  isConfidentMedical,
  saveCalendarCandidate,
} from './saveCalendarCandidate';

interface MedicalAppointmentClassificationScreenProps {
  readonly bridge: CalendarBridge;
  /** Classification consumes the app-owned sync snapshot without requesting Calendar access. */
  readonly calendarSync: CalendarAutoSyncState;
  readonly repository: AppointmentRepository;
  readonly selectedProvider: ProviderSelectionOption | null;
  readonly recipient: string | null;
  /** A failed saved-provider lookup differs from a user who has not selected one yet. */
  readonly selectedProviderUnavailable?: boolean;
  readonly onOpenManual: () => void;
  readonly onOpenCalendarSettings?: () => void;
  readonly onOpenProviderSelection?: () => void;
}

/** One import scans every returned event and saves only confidently medical occurrences. */
export default function MedicalAppointmentClassificationScreen({
  bridge,
  calendarSync,
  repository,
  selectedProvider,
  recipient,
  selectedProviderUnavailable = false,
  onOpenManual,
  onOpenCalendarSettings,
  onOpenProviderSelection,
}: MedicalAppointmentClassificationScreenProps) {
  // Every remote request retains its own disclosure and authorization boundary.
  const { consent, disclosureSheet } = useInferenceConsent();
  const [candidates, setCandidates] = useState<CandidateReview[]>([]);
  const [accessAvailable, setAccessAvailable] = useState(false);
  const [queryComplete, setQueryComplete] = useState(true);
  const [loading, setLoading] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [eventCount, setEventCount] = useState(0);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState('');
  const activeRun = useRef<AbortController | null>(null);

  useEffect(() => {
    setLoading(false);
    setClassifying(false);
    setSavingId(null);
    return () => {
      // Leaving or switching provider prevents subsequent imports and late results.
      activeRun.current?.abort();
      activeRun.current = null;
    };
  }, [bridge, repository, selectedProvider, recipient]);

  const providerReady =
    selectedProvider?.availability.status === 'available' &&
    Boolean(recipient?.trim());
  const calendarUnavailableMessage = calendarSync.error
    ? copy.calendarSyncError
    : !calendarSync.loading && calendarSync.access !== 'fullAccess'
      ? copy.permissionUnavailable
      : '';

  async function importAppointments() {
    // Synchronous ownership prevents double taps before React renders busy state.
    if (activeRun.current) return;
    if (!providerReady || !selectedProvider || !recipient) {
      setMessage(selectedProvider ? copy.providerUnavailable : copy.noProvider);
      return;
    }
    const controller = new AbortController();
    activeRun.current = controller;
    const isCurrent = () =>
      activeRun.current === controller && !controller.signal.aborted;
    setLoading(true);
    setCandidates([]);
    setEventCount(0);
    setSavedIds(new Set());
    setAccessAvailable(false);
    setQueryComplete(true);
    setMessage('');
    try {
      if (calendarSync.loading) {
        setMessage(copy.calendarSyncing);
        return;
      }
      if (calendarSync.error) {
        setMessage(copy.calendarSyncError);
        return;
      }
      const source = {
        access: calendarSync.access ?? 'notDetermined',
        events: calendarSync.events,
        complete: calendarSync.query?.complete === true,
      };
      if (!isCurrent()) return;
      setLoading(false);
      setQueryComplete(source.complete);
      setAccessAvailable(source.access === 'fullAccess');
      setEventCount(source.events.length);
      if (source.access !== 'fullAccess') {
        setMessage(copy.permissionUnavailable);
        return;
      }
      if (!source.events.length) {
        setMessage(copy.noCandidates);
        return;
      }
      setClassifying(true);
      const result = await classifyCalendarEvents({
        bridge,
        events: source.events,
        provider: selectedProvider.provider,
        modelId: selectedProvider.modelId,
        recipient,
        remoteProcessing:
          selectedProvider.privacyBoundary === 'selected-context-remote',
        consent,
        signal: controller.signal,
        onProgress: progress => {
          if (!isCurrent()) return;
          setCandidates([...progress.candidates]);
        },
      });
      if (!isCurrent()) return;
      setCandidates([...result.candidates]);
      // Classification settles before import; unfinished and uncertain rows stay excluded.
      const medical = result.candidates.filter(isConfidentMedical);
      let imported = 0;
      let preserved = 0;
      let saveFailure = '';
      for (const candidate of medical) {
        if (!isCurrent()) return;
        setSavingId(candidate.candidateId);
        try {
          const outcome = await saveCalendarCandidate(
            candidate,
            repository,
            bridge,
            controller.signal,
          );
          if (!isCurrent()) return;
          if (outcome === 'saved') {
            imported += 1;
            setSavedIds(previous =>
              new Set(previous).add(candidate.candidateId),
            );
          } else if (outcome === 'stale') saveFailure = copy.stale;
          else if (outcome === 'preserved') preserved += 1;
        } catch {
          saveFailure = copy.saveError;
        }
      }
      if (!isCurrent()) return;
      const summary = medical.length
        ? [copy.imported(imported), preserved ? copy.preserved(preserved) : '']
            .filter(Boolean)
            .join(' ')
        : copy.noMedical;
      const incomplete =
        result.status !== 'complete' && result.status !== 'empty';
      setMessage(
        saveFailure ||
          (incomplete ? classificationFailureMessage(result.failure) : summary),
      );
    } catch {
      if (isCurrent()) setMessage(copy.manualReview);
    } finally {
      if (isCurrent()) {
        activeRun.current = null;
        setLoading(false);
        setClassifying(false);
        setSavingId(null);
      }
    }
  }

  return (
    <>
      <MedicalAppointmentReviewView
        onOpenProviderSelection={onOpenProviderSelection}
        provider={selectedProvider}
        providerUnavailable={selectedProviderUnavailable}
        providerReady={providerReady}
        loading={loading}
        classifying={classifying}
        accessAvailable={accessAvailable}
        queryComplete={queryComplete}
        message={message || calendarUnavailableMessage}
        eventCount={eventCount}
        candidates={candidates}
        savingId={savingId}
        savedIds={savedIds}
        onImport={importAppointments}
        onOpenManual={onOpenManual}
        calendarLoading={calendarSync.loading}
        calendarUnavailable={
          !calendarSync.loading &&
          (calendarSync.error || calendarSync.access !== 'fullAccess')
        }
        onOpenCalendarSettings={onOpenCalendarSettings}
      />
      {disclosureSheet}
    </>
  );
}
