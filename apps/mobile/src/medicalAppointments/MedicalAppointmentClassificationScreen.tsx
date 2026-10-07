import { useEffect, useRef, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text } from 'react-native';
import type { AppointmentRepository } from '@orot/storage';
import type { ExecutionConsentPort } from '@orot/agent-runtime';
import type { ProviderSelectionOption } from '../providers/selection/types';
import { readUpcomingCalendarCandidates } from './calendarEvidence';
import { medicalAppointmentCopy as copy } from './copy.ko';
import { classifyCalendarEvents } from './classificationWorkflow';
import type { CandidateReview } from './classificationWorkflow';
import type { CalendarBridge, CalendarEvent } from '../calendar/types';
import { MedicalAppointmentCandidateCard } from './MedicalAppointmentCandidateCard';
import { saveCalendarCandidate } from './saveCalendarCandidate';

const styles = StyleSheet.create({
  content: { gap: 12, padding: 20 },
  title: { fontSize: 24, fontWeight: '700' },
});

interface MedicalAppointmentClassificationScreenProps {
  readonly bridge: CalendarBridge;
  readonly repository: AppointmentRepository;
  readonly selectedProvider: ProviderSelectionOption | null;
  readonly recipient: string | null;
  readonly consent: ExecutionConsentPort | null;
  readonly onOpenManual: () => void;
}

/** Keeps every imported candidate visible and leaves saving to an explicit user selection. */
export default function MedicalAppointmentClassificationScreen({
  bridge,
  repository,
  selectedProvider,
  recipient,
  consent,
  onOpenManual,
}: MedicalAppointmentClassificationScreenProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [candidates, setCandidates] = useState<CandidateReview[]>([]);
  const [accessAvailable, setAccessAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [completedBatches, setCompletedBatches] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState('');
  const activeRun = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      // The screen owns this run; clear its state-update handle before abort is observed.
      activeRun.current?.abort();
      activeRun.current = null;
    },
    [],
  );

  const providerReady =
    selectedProvider?.availability.status === 'available' &&
    Boolean(recipient?.trim()) &&
    consent !== null;

  async function loadCandidates() {
    // Candidate IDs are positional, so keep the list stable until an explicit save settles.
    if (savingId !== null) return;
    activeRun.current?.abort();
    activeRun.current = null;
    setClassifying(false);
    setLoading(true);
    setEvents([]);
    setCandidates([]);
    setSavedIds(new Set());
    setAccessAvailable(false);
    setMessage('');
    try {
      const result = await readUpcomingCalendarCandidates(bridge);
      const granted = result.access === 'fullAccess';
      const nextEvents = [...result.events];
      setAccessAvailable(granted);
      setEvents(nextEvents);
      setCandidates(
        nextEvents.map((event, index) => ({
          candidateId: `calendar-candidate-${index + 1}`,
          event,
          status: 'unclassified',
          reason: copy.notClassified,
        })),
      );
      if (!granted) setMessage(copy.permissionUnavailable);
      else if (nextEvents.length === 0) setMessage(copy.noCandidates);
    } catch {
      setMessage(copy.permissionUnavailable);
    } finally {
      setLoading(false);
    }
  }

  async function classifyCandidates() {
    if (!providerReady || !selectedProvider || !consent || !recipient) {
      setMessage(selectedProvider ? copy.providerUnavailable : copy.noProvider);
      return;
    }
    const controller = new AbortController();
    activeRun.current?.abort();
    activeRun.current = controller;
    setClassifying(true);
    setMessage('');
    const result = await classifyCalendarEvents({
      bridge,
      events,
      provider: selectedProvider.provider,
      modelId: selectedProvider.modelId,
      recipient,
      remoteProcessing:
        selectedProvider.privacyBoundary === 'selected-context-remote',
      consent,
      signal: controller.signal,
      onProgress: progress => {
        if (activeRun.current !== controller || controller.signal.aborted)
          return;
        setCandidates([...progress.candidates]);
        setCompletedBatches(progress.completedBatches);
        setTotalBatches(progress.totalBatches);
      },
    });
    if (activeRun.current !== controller || controller.signal.aborted) return;
    setCandidates([...result.candidates]);
    setCompletedBatches(result.completedBatches);
    setTotalBatches(result.totalBatches);
    setClassifying(false);
    if (result.status === 'unavailable' || result.status === 'partial') {
      setMessage(copy.manualReview);
    }
  }

  async function saveAsAppointment(candidate: CandidateReview) {
    setSavingId(candidate.candidateId);
    setMessage('');
    try {
      const outcome = await saveCalendarCandidate(
        candidate,
        repository,
        bridge,
      );
      setMessage(outcome === 'saved' ? copy.saved : copy.stale);
      if (outcome === 'saved') {
        setSavedIds(previous => new Set(previous).add(candidate.candidateId));
      }
    } catch {
      setMessage(copy.saveError);
    } finally {
      setSavingId(null);
    }
  }

  const classifiedCount = candidates.filter(
    candidate => candidate.status === 'classified',
  ).length;
  const providerNotice = selectedProvider
    ? selectedProvider.privacyBoundary === 'on-device'
      ? copy.localNotice
      : copy.remoteNotice
    : '';

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text accessibilityRole="header" style={styles.title}>
        {copy.title}
      </Text>
      <Text>{copy.description}</Text>
      <Text>{copy.queryLimit}</Text>
      <Text>{copy.incompleteCalendar}</Text>
      {providerNotice ? <Text>{providerNotice}</Text> : null}
      {!selectedProvider ? <Text>{copy.noProvider}</Text> : null}
      {selectedProvider?.availability.status === 'unavailable' ? (
        <Text>{copy.providerUnavailable}</Text>
      ) : null}
      {selectedProvider?.availability.status === 'available' &&
      !providerReady ? (
        <Text>{copy.noProvider}</Text>
      ) : null}
      {message ? <Text accessibilityRole="alert">{message}</Text> : null}
      <Button
        disabled={loading || classifying || savingId !== null}
        onPress={loadCandidates}
        title={loading ? copy.loading : copy.loadCalendar}
      />
      <Button
        disabled={
          !providerReady ||
          events.length === 0 ||
          classifying ||
          !accessAvailable
        }
        onPress={classifyCandidates}
        title={classifying ? copy.classifying : copy.classify}
      />
      {events.length > 0 ? (
        <Text>
          {copy.coverage(events.length, classifiedCount)} {completedBatches}/
          {totalBatches}
        </Text>
      ) : null}
      {candidates.map(candidate => (
        <MedicalAppointmentCandidateCard
          key={candidate.candidateId}
          candidate={candidate}
          disabled={savingId !== null}
          isSaved={savedIds.has(candidate.candidateId)}
          isSaving={savingId === candidate.candidateId}
          onSave={saveAsAppointment}
        />
      ))}
      {events.length === 0 && accessAvailable ? (
        <Text>{copy.emptyCoverage}</Text>
      ) : null}
      <Text>{copy.resultNotice}</Text>
      <Button
        onPress={onOpenManual}
        testID="medical-appointment-manual"
        title={copy.manual}
      />
    </ScrollView>
  );
}
