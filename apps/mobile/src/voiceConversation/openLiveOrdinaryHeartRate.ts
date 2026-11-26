import type { SqlDatabase } from '@orot/storage';
import { ensureHealthContextGeneration } from '../healthEvidence/healthContext/generation';
import {
  isCurrentLocalAgentMemoryDatabase,
  openLocalAgentMemoryDatabase,
} from '../storage/secureDatabase';
import { createLiveOrdinaryHeartRateReader } from './liveOrdinaryHeartRateReader';

const readiness = new WeakMap<SqlDatabase, Promise<void>>();

/** Install only the existing structural generation/index setup on the exact
 * protected DB. This cold path never opens broad health reports or RAG. */
export async function readLiveOrdinaryHeartRate(
  input: Omit<
    Parameters<ReturnType<typeof createLiveOrdinaryHeartRateReader>>[0],
    'at' | 'timeZone'
  >,
  confirmProtection: () => Promise<boolean | null>,
) {
  const current = () => !input.signal.aborted && input.current();
  if (!current() || (await confirmProtection()) !== true || !current()) return;
  const database = await openLocalAgentMemoryDatabase();
  const owns = () => current() && isCurrentLocalAgentMemoryDatabase(database);
  if (!owns() || (await confirmProtection()) !== true || !owns()) return;
  let prepare = readiness.get(database);
  if (!prepare) {
    prepare = database
      .transaction(async tx => {
        if (!owns()) throw new Error('Live health owner moved');
        await ensureHealthContextGeneration(tx);
        if (!owns()) throw new Error('Live health owner moved');
      })
      .catch(error => {
        readiness.delete(database);
        throw error;
      });
    readiness.set(database, prepare);
  }
  await prepare;
  if (!owns()) return;
  return createLiveOrdinaryHeartRateReader({
    database,
    ownsDatabase: candidate => candidate === database && owns(),
    confirmProtection,
  })({
    ...input,
    at: new Date().toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}
