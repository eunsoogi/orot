import type { SqlExecutor } from '@orot/storage';
import type { ResearchArtifact } from './researchArtifactStorage';
import { isPeriodSummarySource } from '../diseaseHypotheses/savedSummaries';
import { assertPeriodNotRemoved } from './conversationPeriodRemoval';
import { assertSummaryPeriodCurrent } from './symptomSummaryPeriods';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';

/** Legacy period captures cannot identify already removed contributors from aggregate
 * equality alone. Keep their encrypted snapshots intact; only regeneration under a
 * new identity can replace an unverifiable legacy result. Current-policy captures
 * retain ordinary source validation without a global generation lifetime limit. */
export async function legacyResearchPeriodAvailable(
  tx: SqlExecutor,
  item: ResearchArtifact,
) {
  const tables = await tx.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='research_period_policy'",
  );
  if (tables.rows.length) {
    const policy = await tx.execute(
      'SELECT status FROM research_period_policy WHERE artifact_id=?',
      [item.id],
    );
    if (policy.rows.length) return policy.rows[0]?.status === 'current';
  }
  for (const source of item.inputSources) {
    if (
      !isPeriodSummarySource(source) ||
      !['measurements', 'activity'].includes(source.scope.topic)
    )
      continue;
    try {
      await assertPeriodNotRemoved(tx, source);
      await assertSummaryPeriodCurrent(tx, source, true);
    } catch (error) {
      if (error instanceof RetainedSourceInvalidError) return false;
      throw error;
    }
  }
  return true;
}

export async function markResearchPeriodPolicy(
  tx: SqlExecutor,
  id: number,
  available: boolean,
) {
  await tx.execute(
    'INSERT OR IGNORE INTO research_period_policy(artifact_id,status) VALUES (?,?)',
    [id, available ? 'current' : 'quarantined'],
  );
}
