import type {
  Appointment,
  DoseEvent,
  HealthObservation,
  MedicationDefinition,
  SourceRecord,
  TranscriptEvidenceSegment,
} from '@orot/domain';

export const localQueryWindow = {
  fromInclusive: '2090-01-01T00:00:00.000Z',
  toExclusive: '2090-01-02T00:00:00.000Z',
} as const;

const sourceTime = localQueryWindow.fromInclusive;
const ingestedAt = '2090-01-01T00:10:00.000Z';
const healthSourceId = 'local-query-fixture-health';
const audioSourceId = 'local-query-fixture-audio';
type ProbeSourceRecord = SourceRecord & { contentHash: string };

function metadata(id: string, effectiveAt: string, sourceRecordIds: string[]) {
  return {
    id,
    effectiveAt,
    ingestedAt,
    provenance: {
      origin: 'imported' as const,
      sourceRecordIds,
      source: {
        system: 'healthkit',
        sourceIdentifier: 'com.example.synthetic',
      },
    },
    reviewState: { status: 'unreviewed' as const },
  };
}

function observation(
  id: string,
  concept: string,
  effectiveAt: string,
  value: HealthObservation['value'],
  endedAt?: string,
): HealthObservation {
  return {
    ...metadata(id, effectiveAt, [healthSourceId]),
    ...(endedAt ? { endedAt } : {}),
    observationKind:
      concept === 'HKCategoryTypeIdentifierSleepAnalysis'
        ? 'other'
        : 'measurement',
    concept,
    value,
  };
}

function makeSources(): [ProbeSourceRecord, ProbeSourceRecord] {
  const base = {
    effectiveAt: sourceTime,
    recordedAt: ingestedAt,
    ingestedAt: '2090-01-01T00:11:00.000Z',
    reviewState: { status: 'unreviewed' as const },
  };
  return [
    {
      ...base,
      id: healthSourceId,
      provenance: {
        origin: 'imported',
        sourceRecordIds: [],
        source: { system: 'healthkit' },
      },
      sourceKind: 'device_export',
      title: 'Synthetic local query input',
      contentHash: 'sha256:' + 'c'.repeat(64),
    },
    {
      ...base,
      id: audioSourceId,
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      sourceKind: 'audio_recording',
      contentHash: 'sha256:' + 'd'.repeat(64),
    },
  ];
}

function makeDoseEvent(): Extract<DoseEvent, { eventKind: 'observed' }> {
  return {
    ...metadata('local-query-fixture-dose', '2090-01-01T00:05:00.000Z', [
      healthSourceId,
    ]),
    eventKind: 'observed',
    medicationDefinitionId: 'local-query-fixture-medication',
    observationStatus: 'not_logged',
    scheduleType: 'scheduled',
  };
}

function makeMedication(): MedicationDefinition {
  return {
    id: 'local-query-fixture-medication',
    ingestedAt,
    provenance: {
      origin: 'imported',
      sourceRecordIds: [healthSourceId],
      source: {
        system: 'healthkit',
        sourceIdentifier: 'com.example.synthetic',
      },
    },
    reviewState: { status: 'unreviewed' },
    displayText: 'Synthetic medication',
    medicationConceptIdentifier: 'HealthKit.synthetic.medication',
    generalForm: 'tablet',
    isArchived: false,
    hasSchedule: true,
  };
}

function makeAppointment(): Appointment {
  return {
    id: 'local-query-fixture-calendar',
    effectiveAt: '2090-01-03T09:00:00.000Z',
    recordedAt: ingestedAt,
    ingestedAt,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    status: 'scheduled',
    calendarEventIdentifier: 'synthetic-confirmed-event',
    calendarEventSnapshot: {
      title: 'Synthetic confirmed visit',
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: false,
      occurrenceDate: '2090-01-03T09:00:00.000Z',
      isDetached: false,
      recurrenceRules: [],
    },
  };
}

function makeTranscript(): TranscriptEvidenceSegment {
  const transcriptId = 'local-query-fixture-transcript';
  return {
    id: transcriptId + ':r1',
    transcriptId,
    recordingSourceId: audioSourceId,
    segmentOrdinal: 0,
    revision: 1,
    text: '복용 시간은 저녁이라고 들었어요.',
    language: 'ko-KR',
    recordingDurationMs: 10000,
    audioRange: { startMs: 1000, endMs: 4000 },
    effectiveAt: '2090-01-01T00:07:00.000Z',
    recordedAt: ingestedAt,
    ingestedAt: '2090-01-01T00:11:00.000Z',
    provenance: {
      origin: 'derived',
      sourceRecordIds: [audioSourceId],
      source: {
        system: 'Apple Speech',
        sourceIdentifier: 'synthetic',
        sourceVersion: 'probe',
      },
    },
    reviewState: { status: 'unreviewed' },
  };
}

/** Fixtures use a future-only synthetic range so no existing user records can be read. */
export function createLocalQueryProbeFixtures() {
  const [healthSource, audioSource] = makeSources();
  const healthRows = [
    observation(
      'local-query-bp-systolic',
      'blood pressure systolic',
      '2090-01-01T00:01:00Z',
      {
        kind: 'quantity',
        amount: 120,
        unit: 'mmHg',
      },
    ),
    observation(
      'local-query-bp-diastolic',
      'blood pressure diastolic',
      '2090-01-01T00:01:00Z',
      {
        kind: 'quantity',
        amount: 80,
        unit: 'mmHg',
      },
    ),
    observation(
      'local-query-sleep',
      'HKCategoryTypeIdentifierSleepAnalysis',
      '2090-01-01T22:00:00Z',
      {
        kind: 'text',
        text: 'asleepDeep',
      },
      '2090-01-02T06:00:00Z',
    ),
    observation(
      'local-query-heart-rate',
      'heart_rate',
      '2090-01-01T00:02:00Z',
      {
        kind: 'quantity',
        amount: 72,
        unit: 'count/min',
      },
    ),
    observation('local-query-steps', 'step_count', '2090-01-01T00:03:00Z', {
      kind: 'quantity',
      amount: 1200,
      unit: 'count',
    }),
    observation('local-query-body-mass', 'body_mass', '2090-01-01T00:04:00Z', {
      kind: 'quantity',
      amount: 71.5,
      unit: 'kg',
    }),
  ];
  return {
    healthSource,
    audioSource,
    healthRows,
    dose: makeDoseEvent(),
    medication: makeMedication(),
    appointment: makeAppointment(),
    transcript: makeTranscript(),
  };
}
