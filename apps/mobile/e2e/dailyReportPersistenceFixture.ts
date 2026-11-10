import { HealthObservationSchema } from '@orot/domain';
import { createRecordRepository } from '@orot/storage';
import { NativeModules } from 'react-native';
import { fingerprint } from '../src/aiFeatures/integration/evidenceUtils';
import { createDailyReportCalendarWindow } from '../src/healthEvidence/healthContext/dailyReportWindow';
import { createDailyReportContext } from '../src/healthEvidence/healthContext/dailyReportContext';
import { readHealthContextGeneration } from '../src/healthEvidence/healthContext/generation';
import { createDailyReportStorage } from '../src/storage/dailyReportStorage';
import {
  getCipherVersion,
  openLocalAgentMemoryDatabase,
} from '../src/storage/secureDatabase';

const record = HealthObservationSchema.parse({
  id: 'synthetic-report-observation',
  effectiveAt: '2035-01-01T01:00:00Z',
  recordedAt: '2035-01-01T01:00:00Z',
  ingestedAt: '2035-01-01T01:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  observationKind: 'measurement',
  concept: 'heart_rate',
  value: { kind: 'quantity', amount: 72, unit: 'count/min' },
});
const runId = 'synthetic-report';
const calendar = createDailyReportCalendarWindow({
  localDate: '2035-01-01',
  timeZone: 'Asia/Seoul',
  requestedAt: '2035-01-01T03:00:00Z',
});
if (calendar.status !== 'ready') throw new Error('Invalid synthetic calendar');
const calendarContext = calendar.context;

/** Only the explicit seed launch writes; readback must reopen the existing encrypted store. */
export async function openDailyReportPersistence(mode: 'seed' | 'read') {
  const database = await openLocalAgentMemoryDatabase();
  if (!(await getCipherVersion())) throw new Error('SQLCipher unavailable');
  const process = await NativeModules.OrotTestControl.speechSnapshot();
  if (typeof process.processInstance !== 'string' || !process.processInstance)
    throw new Error('Native process identity unavailable');
  const store = createDailyReportStorage(database);
  if (mode === 'seed') {
    if ((await store.lookup(calendarContext.identity)).status !== 'missing')
      throw new Error('Seed requires an empty report identity');
    const repository = createRecordRepository(database);
    if (await repository.get('health_observation', record.id))
      throw new Error('Seed requires an empty synthetic source');
    await repository.put('health_observation', record);
    const revision = fingerprint(record);
    const context = createDailyReportContext(
      calendarContext,
      {
        revision: 'synthetic-snapshot',
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
      { providerId: 'synthetic-local', modelId: 'synthetic-model' },
    );
    const report = {
      schemaVersion: 1 as const,
      identity: context.identity,
      generatedAt: '2035-01-01T03:01:00Z',
      observations: [
        {
          text: '합성 심박수 기록은 72회예요.',
          sourceReferences: [{ source: 'manual', recordId: record.id }],
        },
      ],
      supportedContext: [],
      coverage: [],
      followUpQuestions: [],
    };
    const outcome = await store.save({
      runId,
      context,
      result: { status: 'completed', report },
      lineage: [
        {
          source: 'manual',
          recordId: record.id,
          kind: 'health_observation',
          localId: record.id,
          revision,
        },
      ],
      mode: { kind: 'initial' },
    });
    if (outcome.status !== 'saved')
      throw new Error('Synthetic report seed failed');
  }
  const saved = await store.lookup(calendarContext.identity);
  if (saved.status !== 'saved' || saved.runId !== runId || saved.revision !== 1)
    throw new Error('Saved synthetic report is unavailable');
  return { store, saved, processInstance: process.processInstance as string };
}
