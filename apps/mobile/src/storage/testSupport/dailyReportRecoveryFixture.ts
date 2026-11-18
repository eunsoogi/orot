import {
  createRecordRepository,
  runMigrations,
  type SqlDatabase,
} from '@orot/storage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { reportObservation } from '../../aiFeatures/integration/testSupport/dailyReportFailureStageFixtures';
import { createDailyReportCalendarWindow } from '../../healthEvidence/healthContext/dailyReportWindow';
import { createDailyReportContext } from '../../healthEvidence/healthContext/dailyReportContext';
import { readHealthContextGeneration } from '../../healthEvidence/healthContext/generation';
import { createDailyReportStorage } from '../dailyReportStorage';

/** Synthetic validated candidate, never a provider response or user record. */
export async function dailyReportRecoveryFixture(database: SqlDatabase) {
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
    { providerId: 'local', modelId: 'fixture' },
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
  const identity = {
    key: context.identity.key,
    providerId: 'local',
    modelId: 'fixture',
    authorizationRevision: 'synthetic-local-owner-v1',
  };
  const witness = {
    identity,
    isCurrent: () => true,
    subscribeInvalidation: (_listener: () => void) => () => {},
  };
  return { candidate, witness };
}
