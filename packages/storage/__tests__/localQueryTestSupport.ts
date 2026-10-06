import type {
  Appointment,
  DoseEvent,
  HealthObservation,
  MedicationDefinition,
  SourceRecord,
  TranscriptEvidenceSegment,
} from '@orot/domain';

const provenance = (source: string, origin: 'imported' | 'user_reported' = 'imported') => ({
  origin,
  sourceRecordIds: ['source-' + source],
  source: { system: source, sourceIdentifier: 'com.example.synthetic' },
});

/** Synthetic rows keep source event time distinct from the app's local ingest time. */
export function healthObservation(
  id: string,
  concept: string,
  effectiveAt: string,
  sourceSystem = 'healthkit',
  origin: 'imported' | 'user_reported' = 'imported',
  endedAt?: string,
): HealthObservation {
  const bloodPressure = concept.startsWith('blood pressure ');
  const unit =
    concept === 'heart_rate'
      ? 'count/min'
      : concept === 'step_count'
        ? 'count'
        : bloodPressure
          ? 'mmHg'
          : 'kg';
  const amount =
    concept === 'blood pressure systolic' ? 120 : concept === 'blood pressure diastolic' ? 80 : 72;
  return {
    id,
    effectiveAt,
    ...(endedAt ? { endedAt } : {}),
    recordedAt: effectiveAt,
    ingestedAt: '2026-10-02T00:00:00.000Z',
    provenance: provenance(sourceSystem, origin),
    reviewState: { status: 'unreviewed' },
    observationKind: concept === 'HKCategoryTypeIdentifierSleepAnalysis' ? 'other' : 'measurement',
    concept,
    value:
      concept === 'HKCategoryTypeIdentifierSleepAnalysis'
        ? { kind: 'text', text: 'asleepCore' }
        : { kind: 'quantity', amount, unit },
  };
}

export function medicationDefinition(id: string, ingestedAt: string): MedicationDefinition {
  return {
    id,
    ingestedAt,
    provenance: provenance('healthkit'),
    reviewState: { status: 'unreviewed' },
    medicationConceptIdentifier: 'HKMedicationConceptIdentifier.synthetic',
    displayText: 'Synthetic medication',
    generalForm: 'tablet',
    isArchived: false,
    hasSchedule: true,
  };
}

export function importedDoseEvent(
  id: string,
  effectiveAt: string,
  observationStatus: Extract<DoseEvent, { eventKind: 'observed' }>['observationStatus'],
): Extract<DoseEvent, { eventKind: 'observed' }> {
  return {
    id,
    effectiveAt,
    recordedAt: effectiveAt,
    ingestedAt: '2026-10-02T00:00:00.000Z',
    provenance: provenance('healthkit'),
    reviewState: { status: 'unreviewed' },
    eventKind: 'observed',
    medicationDefinitionId: 'medication-1',
    observationStatus,
    scheduleType: 'scheduled',
    dose: { amount: 1, unit: 'tablet' },
  };
}

export function appointment(
  id: string,
  effectiveAt: string,
  status: Appointment['status'],
  confirmed: boolean,
): Appointment {
  return {
    id,
    effectiveAt,
    recordedAt: '2026-10-01T00:00:00.000Z',
    ingestedAt: '2026-10-01T00:00:00.000Z',
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    status,
    ...(confirmed
      ? {
          calendarEventIdentifier: 'calendar-event-' + id,
          calendarEventSnapshot: {
            title: 'Synthetic outpatient visit',
            timeZoneIdentifier: 'Asia/Seoul',
            isAllDay: false,
            occurrenceDate: effectiveAt,
            isDetached: false,
            recurrenceRules: [],
          },
        }
      : {}),
  };
}

export function audioSource(id: string): SourceRecord {
  return {
    id,
    effectiveAt: '2026-10-01T00:00:00.000Z',
    recordedAt: '2026-10-01T00:00:00.000Z',
    ingestedAt: '2026-10-01T00:00:00.000Z',
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    sourceKind: 'audio_recording',
    contentHash: 'sha256:' + 'a'.repeat(64),
  };
}

export function transcriptSegment(
  recordingSourceId: string,
  text = '복용 시간을 확인해 주세요.',
): TranscriptEvidenceSegment {
  const transcriptId = recordingSourceId + ':segment:0';
  return {
    id: transcriptId + ':r1',
    transcriptId,
    recordingSourceId,
    segmentOrdinal: 0,
    revision: 1,
    text,
    language: 'ko-KR',
    recordingDurationMs: 5000,
    audioRange: { startMs: 250, endMs: 1800 },
    effectiveAt: '2026-10-01T00:00:01.000Z',
    recordedAt: '2026-10-01T00:00:05.000Z',
    ingestedAt: '2026-10-01T00:00:05.000Z',
    provenance: {
      origin: 'derived',
      sourceRecordIds: [recordingSourceId],
      source: {
        system: 'Apple Speech',
        sourceIdentifier: 'dictation_transcriber',
        sourceVersion: 'iOS synthetic-runtime',
      },
    },
    reviewState: { status: 'unreviewed' },
  };
}
