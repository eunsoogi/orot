import { AppointmentSchema, type Appointment } from '@orot/domain';
import { createFixtureId, createRecordId } from './identity';
import { buildFixtureRecords } from './records';
import type { SyntheticHealthFixture } from './types';

export interface SyntheticVisitQuestionEvidence {
  readonly sourceKind: 'personal_record' | 'reviewed_memory';
  readonly sourceId: string;
  readonly sourceRevision: string;
  readonly evidenceId: string;
  readonly evidenceRevision: string;
  readonly locator: Readonly<Record<string, string>>;
  readonly effectiveTime: string | null;
  readonly reviewState: 'reviewed' | 'unreviewed';
  readonly content: string;
}

export interface SyntheticVisitQuestionCase {
  readonly caseId: string;
  readonly appointment: Appointment;
  readonly appointmentContext: {
    readonly effectiveAt: string;
    readonly timeZoneIdentifier: string | null;
    readonly title: string;
    readonly reason?: string;
  };
  readonly query: string;
  readonly evidence: readonly SyntheticVisitQuestionEvidence[];
  readonly conflicts: readonly string[];
  readonly coverageGaps: readonly string[];
  readonly expected: {
    readonly resultMode: 'suggestions' | 'needs_clarification';
    readonly expectedEvidenceIds: readonly string[];
    readonly requiredTerms: readonly string[];
    readonly appointmentDate: string;
    readonly forbiddenDates: readonly string[];
    readonly requiredValues: readonly string[];
    readonly requiredMeasurements: readonly { readonly value: string; readonly unit: string }[];
    readonly unobservedDates: readonly string[];
  };
}

export interface SyntheticVisitQuestionFixture {
  readonly fixtureId: string;
  readonly disclaimer: SyntheticHealthFixture['disclaimer'];
  readonly reviewedMemory: {
    readonly id: string;
    readonly effectiveAt: string;
    readonly content: string;
    readonly reviewState: 'reviewed';
    readonly sourceRecordIds: readonly string[];
  };
  readonly cases: readonly SyntheticVisitQuestionCase[];
}

const APPOINTMENT_TIME = '2030-05-09T09:00:00Z';
const CALENDAR_SNAPSHOT_TIME = '2030-05-09T00:00:00Z';

/** Reuses seeded synthetic records and adds a reviewed-memory fixture for #30. */
export function createSyntheticVisitQuestionFixture(seed: string): SyntheticVisitQuestionFixture {
  const fixtureId = createFixtureId(seed);
  const records = buildFixtureRecords(fixtureId);
  const sourceById = new Map(records.sourceRecords.map((source) => [source.id, source]));
  const spanByName = new Map(
    records.evidenceSpans.map((span) => [span.id.split(':').at(-1) ?? '', span]),
  );
  const evidence = (name: string): SyntheticVisitQuestionEvidence => {
    const span = spanByName.get(`evidence-${name}`);
    const source = span ? sourceById.get(span.sourceRecordId) : undefined;
    if (!span || !source) throw new Error(`Synthetic evidence fixture is missing ${name}.`);
    return {
      sourceKind: 'personal_record',
      sourceId: source.id,
      sourceRevision: source.ingestedAt,
      evidenceId: span.id,
      evidenceRevision: span.ingestedAt,
      locator: { kind: 'synthetic_record', recordId: source.id },
      effectiveTime: span.effectiveAt,
      reviewState: span.reviewState.status === 'reviewed' ? 'reviewed' : 'unreviewed',
      content: span.text,
    };
  };

  const rescheduled = records.appointments.find((item) => item.status === 'rescheduled');
  if (!rescheduled) throw new Error('Synthetic fixture needs a rescheduled appointment.');
  const appointment = AppointmentSchema.parse({
    ...rescheduled,
    effectiveAt: APPOINTMENT_TIME,
    calendarEventIdentifier: createRecordId(fixtureId, 'calendar-event-next-visit'),
    calendarEventSnapshot: {
      title: '합성 외래 진료',
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: false,
      occurrenceDate: CALENDAR_SNAPSHOT_TIME,
      isDetached: false,
      recurrenceRules: [],
    },
  });
  const appointmentContext = {
    effectiveAt: appointment.effectiveAt,
    timeZoneIdentifier: appointment.calendarEventSnapshot?.timeZoneIdentifier ?? null,
    title: appointment.calendarEventSnapshot?.title ?? '',
    reason: appointment.reason,
  };
  const reviewedMemory = {
    id: createRecordId(fixtureId, 'reviewed-memory-visit-intent'),
    effectiveAt: '2030-04-21T12:00:00Z',
    content: '합성 메모리: 다음 진료에서 수면 기록을 함께 살펴보고 싶어요.',
    reviewState: 'reviewed' as const,
    sourceRecordIds: [createRecordId(fixtureId, 'source-sleep-hours')],
  };
  const memoryEvidence: SyntheticVisitQuestionEvidence = {
    sourceKind: 'reviewed_memory',
    sourceId: reviewedMemory.id,
    sourceRevision: reviewedMemory.effectiveAt,
    evidenceId: createRecordId(fixtureId, 'evidence-reviewed-memory-visit-intent'),
    evidenceRevision: reviewedMemory.effectiveAt,
    locator: { kind: 'synthetic_memory', memoryId: reviewedMemory.id },
    effectiveTime: reviewedMemory.effectiveAt,
    reviewState: 'reviewed',
    content: reviewedMemory.content,
  };
  const cancelledDate = '2030-05-02';
  const nextVisitDate = '2030-05-09';

  return {
    fixtureId,
    disclaimer: 'Synthetic evaluation data only; no real personal data and no clinical validation.',
    reviewedMemory,
    cases: [
      {
        caseId: 'confirmed-next-visit-with-memory',
        appointment,
        appointmentContext,
        query: '다음 진료를 위해 수면 기록과 궁금한 점을 준비해 주세요.',
        evidence: [
          evidence('appointment-cancelled'),
          evidence('appointment-rescheduled'),
          evidence('sleep-hours'),
          evidence('sleep-minutes'),
          memoryEvidence,
        ],
        conflicts: [],
        coverageGaps: [],
        expected: {
          resultMode: 'suggestions',
          expectedEvidenceIds: [
            evidence('appointment-rescheduled').evidenceId,
            evidence('sleep-hours').evidenceId,
            memoryEvidence.evidenceId,
          ],
          requiredTerms: ['수면', '진료'],
          appointmentDate: nextVisitDate,
          forbiddenDates: [cancelledDate],
          requiredValues: ['7.5', '450'],
          requiredMeasurements: [
            { value: '7.5', unit: 'hours' },
            { value: '450', unit: 'minutes' },
          ],
          unobservedDates: [],
        },
      },
      {
        caseId: 'conflicting-medication-needs-clarification',
        appointment,
        appointmentContext,
        query: '기록에 남은 복용 정보가 서로 다르면 확인할 질문을 준비해 주세요.',
        evidence: [
          evidence('old-prescription'),
          evidence('transcript-original'),
          evidence('transcript-correction'),
          evidence('current-medication'),
        ],
        conflicts: ['Synthetic current-medication records conflict with a corrected transcript.'],
        coverageGaps: [],
        expected: {
          resultMode: 'needs_clarification',
          expectedEvidenceIds: [
            evidence('transcript-correction').evidenceId,
            evidence('current-medication').evidenceId,
          ],
          requiredTerms: ['복용', '확인'],
          appointmentDate: nextVisitDate,
          forbiddenDates: [],
          requiredValues: [],
          requiredMeasurements: [],
          unobservedDates: [],
        },
      },
      {
        caseId: 'historical-measurement-without-current-reading',
        appointment,
        appointmentContext: { ...appointmentContext, reason: '합성 혈압 기록 확인' },
        query: '현재 값이 없는 혈압 기록을 진료에서 확인할 질문을 준비해 주세요.',
        evidence: [evidence('bp-systolic'), evidence('bp-diastolic')],
        conflicts: [],
        coverageGaps: ['No synthetic blood-pressure reading is recorded for 2030-04-22.'],
        expected: {
          resultMode: 'needs_clarification',
          expectedEvidenceIds: [
            evidence('bp-systolic').evidenceId,
            evidence('bp-diastolic').evidenceId,
          ],
          requiredTerms: ['혈압', '확인'],
          appointmentDate: nextVisitDate,
          forbiddenDates: [],
          requiredValues: [],
          requiredMeasurements: [],
          unobservedDates: ['2030-04-22'],
        },
      },
    ],
  };
}
