import { IOS_LIBRARY_PATH, isSQLCipher, open } from '@op-engineering/op-sqlite';
import { runMigrations } from '@orot/storage';
import { seedAiScale } from './aiScaleSeed';
import { measureAiScale, measuredScaleDatabase } from './aiScaleMeasurements';

/** Owns one disposable encrypted file; never opens the user's app store or a provider. */
export async function runAiScaleTestOperation(identifier: unknown) {
  if (
    typeof identifier !== 'string' ||
    !/^test-ai-scale-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
      identifier,
    )
  )
    throw new Error('Scale verification requires an isolated UUID');
  if (!isSQLCipher()) throw new Error('Scale verification requires SQLCipher');
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
    await runMigrations(database);
    const scales = [];
    let previous = 0;
    for (const count of [1000, 10000, 50000]) {
      const seedStarted = performance.now();
      await seedAiScale(database, previous, count);
      const seedMs = performance.now() - seedStarted;
      previous = count;
      console.info(
        'OROT_AI_SCALE_SEEDED',
        JSON.stringify({ countPerKind: count, seedMs }),
      );
      const measured = measuredScaleDatabase(database);
      const result = await measureAiScale(measured.database);
      const pageCount = Number(
        (await database.execute('PRAGMA page_count')).rows[0]?.page_count,
      );
      const pageSize = Number(
        (await database.execute('PRAGMA page_size')).rows[0]?.page_size,
      );
      scales.push({
        countPerKind: count,
        totalRecords: count * 6 + 1,
        seedMs,
        databaseBytes: Number.isFinite(pageCount * pageSize)
          ? pageCount * pageSize
          : null,
        ...result,
        sql: { ...measured.metrics },
      });
    }
    return {
      encrypted: true,
      synthetic: true,
      modelInvoked: false,
      cache: 'first adapter cold; SQLite/OS caches not reset',
      scales,
    };
  } finally {
    database.delete();
  }
}
