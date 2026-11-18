import type { SqlExecutor } from '@orot/storage';
import type { SavedPeriodSummarySource } from '../diseaseHypotheses/savedSummaries';
import { assertSummaryPeriodCurrent } from './symptomSummaryPeriods';
import { readHealthContextGeneration } from '../healthEvidence/healthContext/generation';

export type ReadOnlyPeriodValidation = (
  tx: SqlExecutor,
  source: SavedPeriodSummarySource,
  requireGeneration: boolean,
) => Promise<void>;

/** Create only inside an explicitly read-only batch. Never reuse across writes or transactions. */
export function createReadOnlyPeriodValidation(
  snapshot: SqlExecutor,
  calculate: ReadOnlyPeriodValidation = assertSummaryPeriodCurrent,
): ReadOnlyPeriodValidation {
  const validated = new Map<string, string>();
  const generation = async () =>
    JSON.stringify(await readHealthContextGeneration(snapshot));
  return async (tx, source, requireGeneration) => {
    // Bind to this executor as well as the source version; accidental reuse must not bypass checks.
    if (tx !== snapshot) {
      await assertSummaryPeriodCurrent(tx, source, requireGeneration);
      return;
    }
    const key = JSON.stringify([
      source.scope,
      source.revision,
      source.deletionGeneration,
      requireGeneration,
    ]);
    // Native direct execute calls can interleave on the same connection even inside a
    // read-only callback. Never assume transaction identity alone makes the snapshot stable.
    const before = await generation();
    if (validated.get(key) === before) return;
    validated.delete(key);
    await calculate(tx, source, requireGeneration);
    const after = await generation();
    // Only a successful, generation-stable calculation may be reused. Failures are retried.
    // Root and quarantine checks remain separate and run on every validation.
    if (before === after) validated.set(key, before);
  };
}
