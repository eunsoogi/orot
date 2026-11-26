import type { SqlDatabase } from '@orot/storage';
import { readHealthQuantityContext } from '../healthEvidence/healthContext/quantityQuery';
import { readHealthContextGeneration } from '../healthEvidence/healthContext/generation';
import { createLiveHealthProofLease } from '../healthEvidence/healthContext/liveHealthProofLease';
import {
  healthContextDays,
  recentHealthContextWindow,
} from '../healthEvidence/healthContext/window';

type Freshness = Awaited<ReturnType<typeof readHealthContextGeneration>>;
const same = (left: Freshness, right: Freshness) =>
  left.mutationGeneration === right.mutationGeneration &&
  left.deletionGeneration === right.deletionGeneration;

/** Private local reader for the specifically reviewed v2 scope. It only accepts
 * an already prepared, protected DB and never makes schema or evidence writes.
 * The caller must own live v2 policy and separately perform native handoff. */
export function createLiveOrdinaryHeartRateReader({
  database,
  ownsDatabase,
  confirmProtection,
}: {
  database: SqlDatabase;
  ownsDatabase: (database: SqlDatabase) => boolean;
  confirmProtection: () => Promise<boolean | null>;
}) {
  const borrow = createLiveHealthProofLease(database, ownsDatabase);
  return async function read({
    days,
    at,
    timeZone,
    signal,
    current,
  }: {
    days: number;
    /** A fresh app-owned clock and zone, never values supplied by provider arguments. */
    at: string;
    timeZone: string;
    signal: AbortSignal;
    /** Exact current live tool operation + read authorization, never a generic grant. */
    current: () => boolean;
  }) {
    if (
      !Number.isInteger(days) ||
      days < 3 ||
      days > 31 ||
      signal.aborted ||
      !current()
    )
      return;
    const lease = borrow();
    if (!lease) return;
    let retained = false;
    const dispose = () => {
      signal.removeEventListener('abort', dispose);
      lease.dispose();
    };
    signal.addEventListener('abort', dispose, { once: true });
    const isCurrent = () => !signal.aborted && current() && lease.current();
    const protectedNow = async () =>
      isCurrent() && (await confirmProtection()) === true && isCurrent();
    try {
      if (!(await protectedNow())) return;
      const periods = healthContextDays(
        recentHealthContextWindow(days, at, timeZone),
      );
      if (periods.length !== days) return;
      const calculate = async () => {
        let result: { output: string; generation: Freshness } | undefined;
        await database.transaction(async tx => {
          if (!isCurrent()) return;
          const before = await readHealthContextGeneration(tx);
          if (!isCurrent()) return;
          const { series, truncated } = await readHealthQuantityContext(
            tx,
            periods,
            signal,
            'ordinary-heart-rate',
          );
          if (!isCurrent() || truncated || series.length !== 1) return;
          const [quantity] = series;
          if (
            !quantity ||
            quantity.concept !== 'heart_rate' ||
            quantity.unit !== 'count/min' ||
            quantity.days.length < 3 ||
            quantity.days.length > days
          )
            return;
          const count = quantity.days.reduce(
            (sum, day) => sum + day.samples,
            0,
          );
          const mean =
            quantity.days.reduce((sum, day) => sum + day.mean, 0) /
            quantity.days.length;
          // Same two-stage rounding as the existing summary projection/output.
          const dailyMean = Math.round(mean * 100) / 100;
          if (
            !Number.isSafeInteger(count) ||
            count < quantity.days.length ||
            !Number.isFinite(dailyMean) ||
            dailyMean <= 0
          )
            return;
          const after = await readHealthContextGeneration(tx);
          if (!isCurrent() || !same(before, after)) return;
          result = {
            generation: before,
            output: JSON.stringify({
              topic: 'measurements',
              metric: 'heart_rate',
              unit: 'count/min',
              days,
              sampleCount: count,
              meanOfRecordedDailyMeans: Math.round(dailyMean),
            }),
          };
        });
        if (!result || !(await protectedNow())) return;
        // The native probe is an await: recheck committed generation afterward,
        // not merely the transaction's earlier internally consistent snapshot.
        const latest = await readHealthContextGeneration(database);
        return isCurrent() && same(result.generation, latest)
          ? result
          : undefined;
      };
      const original = await calculate();
      if (!original || !isCurrent()) return;
      retained = true;
      return Object.freeze({
        output: original.output,
        proof: {
          current: isCurrent,
          dispose,
          beforeDispatch: (retire: () => void) =>
            isCurrent() ? lease.beforeDispatch(retire) : undefined,
        },
        async reprove() {
          try {
            if (!(await protectedNow())) return false;
            const replay = await calculate();
            return Boolean(
              replay &&
              isCurrent() &&
              same(original.generation, replay.generation) &&
              original.output === replay.output,
            );
          } catch {
            return false;
          }
        },
      });
    } catch {
      return undefined;
    } finally {
      if (!retained) dispose();
    }
  };
}
