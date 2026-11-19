import type { SqlExecutor } from '@orot/storage';
import type { HealthContextReport } from '../healthEvidence/healthContext/types';
import { readHealthContextGeneration } from '../healthEvidence/healthContext/generation';
import { readHealthContextReport } from '../healthEvidence/healthContext/reader';
import { healthContextReportCacheKey } from '../healthEvidence/healthContext/reportCacheKey';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import {
  assertSummaryPeriodCurrent,
  assertSummaryPeriodReport,
} from './symptomSummaryPeriods';
import type { ReadOnlyPeriodValidation } from './readOnlyPeriodValidation';

type Generation = Awaited<ReturnType<typeof readHealthContextGeneration>>;
const same = (a: Generation, b: Generation) =>
  a.mutationGeneration === b.mutationGeneration &&
  a.deletionGeneration === b.deletionGeneration;

/** Only calculations are shared during the validation portion of one write.
 * Every source still validates its own revision and generation requirement.
 * No transaction handling occurs here: SQL, source and cancellation failures
 * retain the writer's rollback contract, never a read-only commit sentinel. */
export async function withWritePeriodCalculations<T>(
  snapshot: SqlExecutor,
  work: (validate: ReadOnlyPeriodValidation) => Promise<T>,
): Promise<T> {
  const reports = new Map<string, HealthContextReport>();
  let active = true;
  let validatedGeneration: Generation | undefined;
  const validate: ReadOnlyPeriodValidation = async (tx, source, required) => {
    if (!active || tx !== snapshot) {
      await assertSummaryPeriodCurrent(tx, source, required);
      return;
    }
    const before = await readHealthContextGeneration(tx);
    const key = healthContextReportCacheKey(source.scope.window, [
      source.scope.topic,
    ]);
    const cached = reports.get(key);
    const report =
      cached && same(cached, before)
        ? cached
        : await readHealthContextReport(tx, source.scope.window, [
            source.scope.topic,
          ]);
    const after = await readHealthContextGeneration(tx);
    if (!active) {
      await assertSummaryPeriodCurrent(tx, source, required);
      return;
    }
    if (!same(before, report) || !same(after, report))
      throw new RetainedSourceInvalidError(
        'Health context changed during write validation.',
      );
    if (validatedGeneration && !same(validatedGeneration, after))
      throw new RetainedSourceInvalidError(
        'Health context changed between write sources.',
      );
    assertSummaryPeriodReport(source, report, required);
    validatedGeneration ??= after;
    if (active) reports.set(key, report);
  };
  try {
    const result = await work(validate);
    // The last source may await native or non-period validation. Do not let an
    // earlier calculation authorize a changed generation at the write boundary.
    if (
      validatedGeneration &&
      !same(validatedGeneration, await readHealthContextGeneration(snapshot))
    )
      throw new RetainedSourceInvalidError(
        'Health context changed before writing.',
      );
    return result;
  } finally {
    active = false;
    reports.clear();
  }
}
