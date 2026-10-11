import { useEffect, useRef, useState } from 'react';
import type { AppointmentRepository } from '@orot/storage';
import { useInferenceConsent } from '../agent/execution/useInferenceConsent';
import type { ProviderSelectionOption } from '../providers/selection/types';
import { readUpcomingCalendarCandidates } from './calendarEvidence';
import { medicalAppointmentCopy as copy } from './copy.ko';
import { classifyCalendarEvents } from './classificationWorkflow';
import type { CandidateReview } from './classificationWorkflow';
import type { CalendarBridge } from '../calendar/types';
import { MedicalAppointmentReviewView } from './MedicalAppointmentReviewView';
import {
  isConfidentMedical,
  saveCalendarCandidate,
} from './saveCalendarCandidate';

interface MedicalAppointmentClassificationScreenProps {
  readonly bridge: CalendarBridge;
  readonly repository: AppointmentRepository;
  readonly selectedProvider: ProviderSelectionOption | null;
  readonly recipient: string | null;
  /** A failed saved-provider lookup differs from a user who has not selected one yet. */
  readonly selectedProviderUnavailable?: boolean;
  readonly onOpenManual: () => void;
}

/** One import scans every returned event and saves only confidently medical occurrences. */
export default function MedicalAppointmentClassificationScreen({
  bridge,
  repository,
  selectedProvider,
  recipient,
  selectedProviderUnavailable = false,
  onOpenManual,
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
      const source = await readUpcomingCalendarCandidates(bridge);
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
        } catch {
          saveFailure = copy.saveError;
        }
      }
      if (!isCurrent()) return;
      const summary = medical.length ? copy.imported(imported) : copy.noMedical;
      const incomplete =
        result.status !== 'complete' && result.status !== 'empty';
      setMessage(saveFailure || (incomplete ? copy.manualReview : summary));
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
        provider={selectedProvider}
        providerUnavailable={selectedProviderUnavailable}
        providerReady={providerReady}
        loading={loading}
        classifying={classifying}
        accessAvailable={accessAvailable}
        queryComplete={queryComplete}
        message={message}
        eventCount={eventCount}
        candidates={candidates}
        savingId={savingId}
        savedIds={savedIds}
        onImport={importAppointments}
        onOpenManual={onOpenManual}
      />
      {disclosureSheet}
    </>
  );
}
