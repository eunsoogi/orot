import { IOS_LIBRARY_PATH, isSQLCipher, open } from '@op-engineering/op-sqlite';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthContextReader } from '../src/healthEvidence/healthContext/reader';
import { HEALTH_CONTEXT_TOPICS } from '../src/healthEvidence/healthContext/types';
import { projectHealthContext } from '../src/healthEvidence/healthContext/projection';
import { recentHealthContextWindow } from '../src/healthEvidence/healthContext/window';
import {
  contextWindow,
  seedHealthContextNativeRecords,
} from './healthContextNativeFixtures';

/** The native test owns one random-key encrypted DB, never the user's health store, Keychain or network. */
export async function runHealthContextTestOperation(identifier: unknown) {
  if (
    typeof identifier !== 'string' ||
    !/^test-health-context-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
      identifier,
    )
  )
    throw new Error('Health context verification requires an isolated UUID');
  if (!isSQLCipher())
    throw new Error('Health context verification requires SQLCipher');
  const random = new Uint8Array(32);
  globalThis.crypto.getRandomValues(random);
  const database = open({
    name: identifier + '.db',
    location: IOS_LIBRARY_PATH,
    encryptionKey: Array.from(random, byte =>
      byte.toString(16).padStart(2, '0'),
    ).join(''),
  });
  try {
    const cipher = await database.execute('PRAGMA cipher_version');
    if (!cipher.rows[0]?.cipher_version)
      throw new Error('SQLCipher is unavailable');
    await runMigrations(database);
    const records = createRecordRepository(database);
    await seedHealthContextNativeRecords(records);
    const read = createHealthContextReader(database);
    const started = Date.now();
    const report = await read(contextWindow, HEALTH_CONTEXT_TOPICS);
    const elapsedMs = Date.now() - started;
    const cached = await read(contextWindow, HEALTH_CONTEXT_TOPICS);
    // Exercise the largest allowed calendar span on Hermes/SQLCipher as well as the four-day exact oracle.
    const longStarted = Date.now();
    const longReport = await read(
      recentHealthContextWindow(
        90,
        contextWindow.toExclusive,
        contextWindow.timeZone,
      ),
      HEALTH_CONTEXT_TOPICS,
    );
    const longElapsedMs = Date.now() - longStarted;
    const pressure = report.quantities.find(
      series => series.concept === 'blood pressure systolic',
    );
    const stepSums = report.quantities
      .filter(series => series.concept === 'step_count')
      .map(series => series.days.reduce((sum, day) => sum + day.sum, 0))
      .sort((a, b) => a - b);
    await records.delete('health_observation', 'bp-1-0');
    const deleted = await read(contextWindow, HEALTH_CONTEXT_TOPICS);
    const changedPressure = deleted.quantities.find(
      series => series.concept === 'blood pressure systolic',
    );
    const projected = projectHealthContext(report);
    return {
      encrypted: true,
      synthetic: true,
      calendarDays: report.days.length,
      firstDate: report.days[0]?.date,
      pressureDays: pressure?.days.length,
      pressureSamples: pressure?.days.reduce(
        (sum, day) => sum + day.samples,
        0,
      ),
      pressureDailyMeans: pressure?.days.map(day => day.mean),
      bodyMass: report.quantities.find(series => series.concept === 'body_mass')
        ?.days[0]?.latest,
      stepSums,
      medication: report.medications[0],
      sleep: report.sleep[0],
      symptoms: report.symptoms,
      cacheReused: cached === report,
      deletionInvalidated:
        deleted.deletionGeneration > report.deletionGeneration &&
        changedPressure?.days[0]?.samples === 1 &&
        changedPressure.days[0].mean === 141,
      tempStore: (await database.execute('PRAGMA temp_store')).rows[0]
        ?.temp_store,
      projectedBytes: new TextEncoder().encode(JSON.stringify(projected))
        .byteLength,
      longWindowDays: longReport.days.length,
      longProjectedBytes: new TextEncoder().encode(
        JSON.stringify(projectHealthContext(longReport)),
      ).byteLength,
      longElapsedMs,
      elapsedMs,
    };
  } finally {
    database.delete();
  }
}
