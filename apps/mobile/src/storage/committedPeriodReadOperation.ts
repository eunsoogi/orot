import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import type { HealthContextReport } from '../healthEvidence/healthContext/types';
import { readHealthContextReport } from '../healthEvidence/healthContext/reader';
import { readHealthContextGeneration } from '../healthEvidence/healthContext/generation';
import {
  assertSummaryPeriodReport,
  assertSummaryPeriodCurrent,
} from './symptomSummaryPeriods';
import type { ReadOnlyPeriodValidation } from './readOnlyPeriodValidation';

type Pair = Awaited<ReturnType<typeof readHealthContextGeneration>>;
const same = (a: Pair, b: Pair) =>
  a.mutationGeneration === b.mutationGeneration &&
  a.deletionGeneration === b.deletionGeneration;

/** Owned by one production DB reader. Only committed report values cross read
 * transactions; parent, policy, marker and source-validity checks never do. */
export function committedPeriodReadOperation(
  database: SqlDatabase,
  signal?: AbortSignal,
) {
  const reports = new Map<string, HealthContextReport>();
  let disposed = false;
  const cancel = () => reports.clear();
  const dispose = () => {
    disposed = true;
    reports.clear();
    signal?.removeEventListener('abort', cancel);
  };
  signal?.addEventListener('abort', cancel, { once: true });
  const check = () => {
    if (signal?.aborted) throw new Error('Conversation read was cancelled.');
  };
  return {
    dispose,
    get active() {
      return !disposed;
    },
    async run(
      work: (
        tx: SqlExecutor,
        validate: ReadOnlyPeriodValidation,
      ) => Promise<void>,
    ) {
      check();
      const pending = new Map<string, HealthContextReport>();
      let failure: { error: unknown } | undefined;
      await database.transaction(async tx => {
        const validate: ReadOnlyPeriodValidation = async (
          executor,
          source,
          required,
        ) => {
          if (executor !== tx) {
            await assertSummaryPeriodCurrent(executor, source, required);
            return;
          }
          check();
          const before = await readHealthContextGeneration(tx);
          check();
          const key = JSON.stringify([
            source.scope.window,
            [source.scope.topic],
          ]);
          const cached = reports.get(key);
          const report =
            cached && same(cached, before)
              ? cached
              : await readHealthContextReport(
                  tx,
                  source.scope.window,
                  [source.scope.topic],
                  signal,
                );
          const after = await readHealthContextGeneration(tx);
          check();
          if (!same(before, report) || !same(after, report))
            throw new Error('Health context changed during validation.');
          assertSummaryPeriodReport(source, report, required);
          pending.set(key, report);
        };
        try {
          await work(tx, validate);
          check();
        } catch (error) {
          // Read validation can observe native direct writes on this connection.
          // Do not roll them back merely because the read fails or is cancelled.
          // Existing non-destructive quarantine audit writes also remain intact.
          failure = { error };
        }
      });
      if (failure) throw failure.error;
      check();
      const committed = await readHealthContextGeneration(database);
      check();
      for (const report of pending.values())
        if (!same(report, committed))
          throw new Error('Health context changed before read publication.');
      if (!disposed)
        for (const [key, report] of pending) reports.set(key, report);
    },
  };
}
