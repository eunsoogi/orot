import type { EvidenceSpan, SourceRecord } from '@orot/domain';
import { createRecordId } from './identity';
import { evidenceSpan, sourceRecord } from './recordMetadata';

export interface FixtureSourceIds {
  encounter: string;
  oldPrescription: string;
  currentMedication: string;
  transcriptOriginal: string;
  transcriptCorrection: string;
  bloodPressure: string;
  sleepHours: string;
  sleepMinutes: string;
  symptom: string;
  appointmentCancelled: string;
  appointmentRescheduled: string;
}

export function buildSourceFixtures(fixtureId: string) {
  const id = (name: string) => createRecordId(fixtureId, name);
  const source: FixtureSourceIds = {
    encounter: id('source-encounter'),
    oldPrescription: id('source-old-prescription'),
    currentMedication: id('source-current-medication'),
    transcriptOriginal: id('source-transcript-original'),
    transcriptCorrection: id('source-transcript-correction'),
    bloodPressure: id('source-blood-pressure'),
    sleepHours: id('source-sleep-hours'),
    sleepMinutes: id('source-sleep-minutes'),
    symptom: id('source-symptom'),
    appointmentCancelled: id('source-appointment-cancelled'),
    appointmentRescheduled: id('source-appointment-rescheduled'),
  };

  const sourceRecords: SourceRecord[] = [
    sourceRecord(
      source.encounter,
      'clinician_note',
      'Synthetic outpatient note',
      '2030-04-19T11:00:00Z',
      'clinician_recorded',
    ),
    sourceRecord(
      source.oldPrescription,
      'prescription',
      'Synthetic historical prescription',
      '2025-01-10T09:00:00Z',
      'imported',
    ),
    sourceRecord(
      source.currentMedication,
      'user_note',
      'Synthetic current medication list',
      '2030-04-20T08:00:00Z',
      'user_reported',
      '2030-04-21T10:00:00Z',
    ),
    sourceRecord(
      source.transcriptOriginal,
      'other',
      'Synthetic transcript revision 1',
      '2030-04-20T08:00:00Z',
      'imported',
    ),
    sourceRecord(
      source.transcriptCorrection,
      'other',
      'Synthetic corrected transcript',
      '2030-04-20T08:00:00Z',
      'imported',
      '2030-04-22T11:00:00Z',
      '2030-04-22T11:05:00Z',
    ),
    sourceRecord(
      source.bloodPressure,
      'device_export',
      'Synthetic historical blood-pressure export',
      '2030-04-18T09:00:00Z',
      'device_recorded',
    ),
    sourceRecord(
      source.sleepHours,
      'device_export',
      'Synthetic sleep export in hours',
      '2030-04-20T06:00:00Z',
      'device_recorded',
    ),
    sourceRecord(
      source.sleepMinutes,
      'device_export',
      'Synthetic sleep export in minutes',
      '2030-04-20T06:00:00Z',
      'device_recorded',
    ),
    sourceRecord(
      source.symptom,
      'user_note',
      'Synthetic symptom note',
      '2030-04-19T11:05:00Z',
      'user_reported',
    ),
    sourceRecord(
      source.appointmentCancelled,
      'user_note',
      'Synthetic cancelled appointment',
      '2030-05-02T09:00:00Z',
      'user_reported',
      '2030-04-25T08:00:00Z',
    ),
    sourceRecord(
      source.appointmentRescheduled,
      'user_note',
      'Synthetic rescheduled appointment',
      '2030-05-09T09:00:00Z',
      'user_reported',
      '2030-04-25T08:05:00Z',
    ),
  ];

  const evidenceSpans: EvidenceSpan[] = [
    evidenceSpan(
      id('evidence-encounter'),
      source.encounter,
      '2030-04-19T11:00:00Z',
      'Synthetic outpatient encounter recorded; no diagnosis is supplied.',
    ),
    evidenceSpan(
      id('evidence-old-prescription'),
      source.oldPrescription,
      '2025-01-10T09:00:00Z',
      'MockMed-A prescription interval: 2025-01-10 through 2025-01-24.',
    ),
    evidenceSpan(
      id('evidence-current-medication'),
      source.currentMedication,
      '2030-04-20T08:00:00Z',
      'Synthetic user confirmation lists MockMed-A as current.',
    ),
    evidenceSpan(
      id('evidence-transcript-original'),
      source.transcriptOriginal,
      '2030-04-20T08:00:00Z',
      'ASR revision 1: “I am taking MockMed-A.”',
    ),
    evidenceSpan(
      id('evidence-transcript-correction'),
      source.transcriptCorrection,
      '2030-04-20T08:00:00Z',
      'Correction: “I am not taking MockMed-A now.”',
    ),
    evidenceSpan(
      id('evidence-bp-systolic'),
      source.bloodPressure,
      '2030-04-18T09:00:00Z',
      'Synthetic device reading at 2030-04-18 09:00Z: systolic 118 mmHg.',
    ),
    evidenceSpan(
      id('evidence-bp-diastolic'),
      source.bloodPressure,
      '2030-04-18T09:00:00Z',
      'Synthetic device reading at 2030-04-18 09:00Z: diastolic 76 mmHg.',
    ),
    evidenceSpan(
      id('evidence-sleep-hours'),
      source.sleepHours,
      '2030-04-20T06:00:00Z',
      'Synthetic sleep duration for 2030-04-20: 7.5 hours.',
    ),
    evidenceSpan(
      id('evidence-sleep-minutes'),
      source.sleepMinutes,
      '2030-04-20T06:00:00Z',
      'Synthetic sleep duration for the same interval: 450 minutes.',
    ),
    evidenceSpan(
      id('evidence-symptom'),
      source.symptom,
      '2030-04-19T11:05:00Z',
      'Synthetic note reports intermittent headache; it states no cause or diagnosis.',
    ),
    evidenceSpan(
      id('evidence-appointment-cancelled'),
      source.appointmentCancelled,
      '2030-04-25T08:00:00Z',
      'Synthetic appointment for 2030-05-02 was cancelled.',
    ),
    evidenceSpan(
      id('evidence-appointment-rescheduled'),
      source.appointmentRescheduled,
      '2030-04-25T08:05:00Z',
      'Synthetic appointment was rescheduled to 2030-05-09.',
    ),
  ];

  return { source, sourceRecords, evidenceSpans };
}
