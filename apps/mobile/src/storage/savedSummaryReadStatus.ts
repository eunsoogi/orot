import type { SqlExecutor } from '@orot/storage';
import type { SavedSummaryReadStatus } from '../diseaseHypotheses/savedSummaries';
import { decodeSavedSymptomSummary } from './symptomSummaryStorageCodec';
import { visibleSummary } from './symptomSummaryQuarantine';

/** Return a content-free reason for quarantined legacy rows. CASE prevents their
 * retained text from crossing the storage boundary; sourceChanged keeps its prior meaning. */
export async function readSavedSummaryStatus(
  database: SqlExecutor,
  id: string,
): Promise<SavedSummaryReadStatus | null> {
  const result = await database.execute(
    `SELECT CASE WHEN policy.status = 'quarantined' THEN NULL ELSE r.result_json END AS result_json,
      policy.status AS policy_status,
      EXISTS (SELECT 1 FROM conversation_invalid_summaries invalid WHERE invalid.id = r.id) AS invalid
     FROM symptom_summary_runs r LEFT JOIN summary_period_policy policy ON policy.summary_id = r.id
     WHERE r.id = ? AND (policy.status = 'quarantined' OR (${visibleSummary}))`,
    [id],
  );
  if (result.rows[0]?.policy_status === 'quarantined')
    return { status: 'unavailable', reason: 'legacy_period_unverified' };
  const summary = decodeSavedSymptomSummary(result.rows[0]?.result_json);
  return summary
    ? { summary, sourceChanged: result.rows[0]?.invalid === 1 }
    : null;
}
