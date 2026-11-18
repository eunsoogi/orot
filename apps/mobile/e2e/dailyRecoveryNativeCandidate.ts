import {
  createRecordRepository,
  runMigrations,
  type SqlDatabase,
} from '@orot/storage';
import { fingerprint } from '../src/aiFeatures/integration/evidenceUtils';
import { HealthObservationSchema } from '@orot/domain';
const reportObservation = HealthObservationSchema.parse({
  id: 'synthetic-report-source',
  effectiveAt: '2035-01-01T01:00:00Z',
  recordedAt: '2035-01-01T01:00:00Z',
  ingestedAt: '2035-01-01T01:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  observationKind: 'measurement',
  concept: 'heart_rate',
  value: { kind: 'quantity', amount: 72, unit: 'count/min' },
});
import { createDailyReportCalendarWindow } from '../src/healthEvidence/healthContext/dailyReportWindow';
import { createDailyReportContext } from '../src/healthEvidence/healthContext/dailyReportContext';
import { readHealthContextGeneration } from '../src/healthEvidence/healthContext/generation';
import { createDailyReportStorage } from '../src/storage/dailyReportStorage';

/** Synthetic validated candidate, never a provider response or user record. */
export async function createNativeDailyRecoveryCandidate(
  database: SqlDatabase,
) {
  await runMigrations(database);
  const calendar = createDailyReportCalendarWindow({
    localDate: '2035-01-01',
    timeZone: 'UTC',
    requestedAt: '2035-01-01T12:00:00Z',
  });
  if (calendar.status !== 'ready')
    throw new Error('Invalid synthetic calendar');
  await createDailyReportStorage(database).lookup(calendar.context.identity);
  await createRecordRepository(database).put(
    'health_observation',
    reportObservation,
  );
  const revision = fingerprint(reportObservation);
  const context = createDailyReportContext(
    calendar.context,
    {
      revision: 'synthetic-snapshot',
      ...(await readHealthContextGeneration(database)),
      records: [
        {
          source: 'manual',
          recordId: reportObservation.id,
          revision,
          occurrence: { startInclusive: reportObservation.effectiveAt! },
          ingestedAt: reportObservation.ingestedAt,
        },
      ],
      coverage: [],
    },
    { providerId: 'openai-api-decisions', modelId: 'synthetic-model' },
  );
  const candidate = {
    runId: 'synthetic-recovery-run',
    context,
    result: {
      status: 'completed',
      report: {
        schemaVersion: 1,
        identity: context.identity,
        generatedAt: '2035-01-01T12:01:00Z',
        observations: [
          {
            text: 'Synthetic report',
            sourceReferences: [
              { source: 'manual', recordId: reportObservation.id },
            ],
          },
        ],
        supportedContext: [],
        coverage: [],
        followUpQuestions: [],
      },
    },
    lineage: [
      {
        source: 'manual',
        recordId: reportObservation.id,
        kind: 'health_observation' as const,
        localId: reportObservation.id,
        revision,
      },
    ],
    mode: { kind: 'initial' as const },
  };
  return candidate;
}
