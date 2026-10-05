import type {
  Appointment,
  DoseEvent,
  Encounter,
  HealthObservation,
  MedicationAssertion,
  SymptomEntry,
} from '@orot/domain';
import { createRecordId } from './identity';
import type { SyntheticHealthFixture, TranscriptRevision } from './types';
import { metadata } from './recordMetadata';
import { buildSourceFixtures } from './sourceRecords';

type FixtureRecords = Omit<
  SyntheticHealthFixture,
  'fixtureId' | 'disclaimer' | 'expectedEvidence' | 'cases'
>;

export function buildFixtureRecords(fixtureId: string): FixtureRecords {
  const id = (name: string) => createRecordId(fixtureId, name);
  const { source, sourceRecords, evidenceSpans } = buildSourceFixtures(fixtureId);

  const encounters: Encounter[] = [
    {
      ...metadata(
        id('encounter-outpatient'),
        '2030-04-19T11:00:00Z',
        'clinician_recorded',
        [source.encounter],
        '2030-04-19T11:10:00Z',
      ),
      encounterKind: 'outpatient',
      endedAt: '2030-04-19T11:30:00Z',
      summary: 'Synthetic encounter; no diagnosis is asserted.',
    },
  ];

  const transcripts: TranscriptRevision[] = [
    {
      id: id('transcript-original'),
      sourceRecordId: source.transcriptOriginal,
      revision: 1,
      text: 'I am taking MockMed-A.',
    },
    {
      id: id('transcript-correction'),
      sourceRecordId: source.transcriptCorrection,
      revision: 2,
      text: 'I am not taking MockMed-A now.',
      correctedFrom: id('transcript-original'),
    },
  ];

  const observations: HealthObservation[] = [
    {
      ...metadata(id('bp-systolic-historical'), '2030-04-18T09:00:00Z', 'device_recorded', [
        source.bloodPressure,
      ]),
      observationKind: 'measurement',
      concept: 'blood_pressure_systolic',
      value: { kind: 'quantity', amount: 118, unit: 'mmHg' },
    },
    {
      ...metadata(id('bp-diastolic-historical'), '2030-04-18T09:00:00Z', 'device_recorded', [
        source.bloodPressure,
      ]),
      observationKind: 'measurement',
      concept: 'blood_pressure_diastolic',
      value: { kind: 'quantity', amount: 76, unit: 'mmHg' },
    },
    {
      ...metadata(id('sleep-duration-hours'), '2030-04-20T06:00:00Z', 'device_recorded', [
        source.sleepHours,
      ]),
      observationKind: 'measurement',
      concept: 'sleep_duration',
      value: { kind: 'quantity', amount: 7.5, unit: 'hours' },
    },
    {
      ...metadata(id('sleep-duration-minutes'), '2030-04-20T06:00:00Z', 'device_recorded', [
        source.sleepMinutes,
      ]),
      observationKind: 'measurement',
      concept: 'sleep_duration',
      value: { kind: 'quantity', amount: 450, unit: 'minutes' },
    },
  ];

  const medicationAssertions: MedicationAssertion[] = [
    {
      ...metadata(id('prescription-old'), '2025-01-10T09:00:00Z', 'imported', [
        source.oldPrescription,
      ]),
      assertionKind: 'prescribed',
      medicationName: 'MockMed-A',
      dosageInstruction: 'Synthetic placeholder instruction A',
      endsAt: '2025-01-24T09:00:00Z',
    },
    {
      ...metadata(
        id('medication-current-confirmation'),
        '2030-04-20T08:00:00Z',
        'user_reported',
        [source.currentMedication],
        '2030-04-21T10:00:00Z',
      ),
      assertionKind: 'current_medication_confirmation',
      medicationName: 'MockMed-A',
      dosageInstruction: 'Synthetic placeholder instruction A',
      confirmedByUserId: id('synthetic-user'),
    },
  ];

  const doseEvents: DoseEvent[] = [
    {
      ...metadata(id('dose-event-historical'), '2025-01-18T09:00:00Z', 'imported', [
        source.oldPrescription,
      ]),
      eventKind: 'missed',
      medicationAssertionId: id('prescription-old'),
      dose: { amount: 1, unit: 'placeholder unit' },
    },
  ];

  const symptoms: SymptomEntry[] = [
    {
      ...metadata(id('symptom-headache'), '2030-04-19T11:05:00Z', 'user_reported', [
        source.symptom,
      ]),
      description: 'Synthetic intermittent headache reported; no cause or diagnosis recorded.',
      bodySite: 'head',
    },
  ];

  const appointments: Appointment[] = [
    {
      ...metadata(
        id('appointment-cancelled'),
        '2030-05-02T09:00:00Z',
        'user_reported',
        [source.appointmentCancelled],
        '2030-04-25T08:00:00Z',
      ),
      status: 'cancelled',
      reason: 'Synthetic schedule change.',
    },
    {
      ...metadata(
        id('appointment-rescheduled'),
        '2030-05-09T09:00:00Z',
        'user_reported',
        [source.appointmentRescheduled],
        '2030-04-25T08:05:00Z',
      ),
      status: 'rescheduled',
      reason: 'Synthetic schedule change.',
    },
  ];

  return {
    sourceRecords,
    evidenceSpans,
    encounters,
    transcripts,
    observations,
    medicationAssertions,
    doseEvents,
    symptoms,
    appointments,
  };
}
