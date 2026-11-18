import {
  AppointmentSchema,
  HealthObservationSchema,
  VisitQuestionCreateSchema,
} from '@orot/domain';
import type { RecordRepository, SqlDatabase } from '@orot/storage';
import { fingerprint } from '../src/aiFeatures/integration/evidenceUtils';
import { createSymptomSummaryStorage } from '../src/storage/symptomSummaryStorage';
import { seedRoutesDailyReport } from './routesDailyReportFixture';

export const routesGeneratedRecords = {
  sourceId: 'synthetic-routes-observation',
  appointmentId: 'synthetic-routes-appointment',
  summaryIds: [
    'synthetic-routes-possibilities',
    'synthetic-routes-health-summary',
  ],
  dailyRunId: 'synthetic-routes-daily-report',
  questionId: 'synthetic-routes-question',
  possibilitiesText: '합성 기록에서 살펴볼 가능성이에요.',
  summaryText: '합성 건강 정보 요약이에요.',
  dailyText: '합성 오늘의 보고서예요.',
  questionText: '합성 건강 기록을 진료에서 확인할까요?',
} as const;

const at = '2035-01-01T01:00:00.000Z';

/** Caller must authorize the isolated synthetic mode before opening the database.
 * Real writers install and enforce source/deletion guards; no reader is replaced. */
export async function seedRoutesGeneratedRecords(
  database: SqlDatabase,
  records: RecordRepository,
) {
  const ids = routesGeneratedRecords;
  for (const kind of [
    'health_observation',
    'appointment',
    'visit_question',
  ] as const) {
    if ((await records.list(kind)).length)
      throw new Error('Routes seed requires empty record stores');
  }
  const summaries = createSymptomSummaryStorage(database);
  if ((await summaries.list()).length)
    throw new Error('Routes seed requires an empty generated-result store');
  const record = HealthObservationSchema.parse({
    id: ids.sourceId,
    effectiveAt: at,
    recordedAt: at,
    ingestedAt: at,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    observationKind: 'measurement',
    concept: 'heart_rate',
    value: { kind: 'quantity', amount: 72, unit: 'count/min' },
  });
  await records.put('health_observation', record);
  const revision = fingerprint(record);
  const reference = {
    sourceKind: 'personal_record' as const,
    sourceId: record.id,
    evidenceId: record.id,
    sourceRevision: revision,
    evidenceRevision: revision,
    reviewState: 'unreviewed' as const,
    effectiveTime: at,
    locator: { kind: 'structured_record', recordId: record.id },
  };
  for (const [index, id] of ids.summaryIds.entries()) {
    await summaries.append({
      id,
      createdAt: at,
      providerId: 'synthetic-local',
      modelId: 'synthetic-routes',
      modelName: '합성 기록 모델',
      inputLineage: 'complete',
      analysis: {
        ...(index === 1 ? { presentation: 'symptom_summary' as const } : {}),
        hypotheses: [
          {
            title: index === 1 ? '합성 건강 요약' : '합성 가능성',
            summary: index === 1 ? ids.summaryText : ids.possibilitiesText,
            supportingEvidence: [reference],
            contraryEvidence: [],
            uncertainty: '실제 진단이 아닌 테스트 자료예요.',
            missingData: [],
          },
        ],
      },
      sources: [
        {
          reference,
          records: [{ kind: 'health_observation', id: record.id, revision }],
        },
      ],
    });
  }
  await seedRoutesDailyReport(database, record, ids.dailyRunId, ids.dailyText);
  const appointment = AppointmentSchema.parse({
    id: ids.appointmentId,
    effectiveAt: '2035-06-02T09:30:00.000Z',
    endsAt: '2035-06-02T10:30:00.000Z',
    recordedAt: at,
    ingestedAt: at,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    status: 'scheduled',
    clinicLabel: '합성 진료 예약',
    calendarEventIdentifier: 'synthetic-routes-calendar',
    calendarEventSnapshot: {
      title: '합성 진료 예약',
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: false,
      occurrenceDate: null,
      isDetached: false,
      recurrenceRules: [],
    },
  });
  await records.put('appointment', appointment);
  const saved = await summaries.read(ids.summaryIds[1]);
  if (!saved) throw new Error('Synthetic summary was not retained');
  await records.put(
    'visit_question',
    VisitQuestionCreateSchema.parse({
      id: ids.questionId,
      effectiveAt: appointment.effectiveAt,
      recordedAt: at,
      ingestedAt: at,
      provenance: { origin: 'derived', sourceRecordIds: [appointment.id] },
      reviewState: {
        status: 'reviewed',
        reviewerId: 'synthetic-local',
        reviewedAt: at,
      },
      questionText: ids.questionText,
      rationale: '합성 요약을 바탕으로 준비한 질문이에요.',
      priority: 'routine',
      evidenceSpanIds: [],
      appointmentId: appointment.id,
      position: 1,
      generatedArtifactSources: [
        {
          kind: 'generated_summary',
          type: 'symptom_summary',
          id: saved.id,
          revision: fingerprint(saved),
        },
      ],
    }),
  );
  return ids;
}
