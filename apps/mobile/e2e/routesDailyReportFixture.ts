import type { HealthObservation } from '@orot/domain';
import type { SqlDatabase } from '@orot/storage';
import { fingerprint } from '../src/aiFeatures/integration/evidenceUtils';
import { createDailyReportCalendarWindow } from '../src/healthEvidence/healthContext/dailyReportWindow';
import { createDailyReportContext } from '../src/healthEvidence/healthContext/dailyReportContext';
import { readHealthContextGeneration } from '../src/healthEvidence/healthContext/generation';
import { createDailyReportStorage } from '../src/storage/dailyReportStorage';

/** A synthetic result still uses the production save and exact source revision contract. */
export async function seedRoutesDailyReport(
  database: SqlDatabase,
  record: HealthObservation,
  runId: string,
  text: string,
) {
  const calendar = createDailyReportCalendarWindow({
    localDate: '2035-01-01',
    timeZone: 'UTC',
    requestedAt: '2035-01-01T12:00:00.000Z',
  });
  if (calendar.status !== 'ready')
    throw new Error('Invalid synthetic calendar');
  const storage = createDailyReportStorage(database);
  if ((await storage.lookup(calendar.context.identity)).status !== 'missing')
    throw new Error('Routes daily identity already exists');
  const revision = fingerprint(record);
  const context = createDailyReportContext(
    calendar.context,
    {
      revision: fingerprint({ record, calendar: calendar.context }),
      ...(await readHealthContextGeneration(database)),
      records: [
        {
          source: 'manual',
          recordId: record.id,
          revision,
          occurrence: { startInclusive: record.effectiveAt! },
          ingestedAt: record.ingestedAt,
        },
      ],
      coverage: [],
    },
    { providerId: 'synthetic-local', modelId: 'synthetic-routes' },
  );
  const outcome = await storage.save({
    runId,
    context,
    mode: { kind: 'initial' },
    result: {
      status: 'completed',
      report: {
        schemaVersion: 1,
        identity: context.identity,
        generatedAt: '2035-01-01T12:01:00.000Z',
        observations: [
          {
            text,
            sourceReferences: [{ source: 'manual', recordId: record.id }],
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
        recordId: record.id,
        kind: 'health_observation',
        localId: record.id,
        revision,
      },
    ],
  });
  if (outcome.status !== 'saved')
    throw new Error('Synthetic daily save failed');
}
