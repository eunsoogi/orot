import {
  localQueryTimestampKey,
  localQueryTimestampKeyExpression,
  type SqlExecutor,
} from '@orot/storage';
import { currentEvidenceCondition } from '../../healthEvidence/evidenceCandidateScope';
import {
  overviewSleepStage,
  projectLatestSleepEpisode,
} from './overviewSleepEpisode';

const readLimit = 512;

/** A bounded local-only sibling of the Overview summary, using the same protected
 * snapshot and current-evidence rule. Never export raw source names or combine
 * samples from devices whose exact provenance cannot be established. */
export async function readOverviewSleepEpisode(
  tx: SqlExecutor,
  latestAsleepStart: string,
  window: { fromInclusive: string; toExclusive: string },
) {
  const newest = Date.parse(latestAsleepStart);
  const through = Date.parse(window.toExclusive);
  const floor = Math.max(
    Date.parse(window.fromInclusive),
    newest - 36 * 3_600_000,
  );
  if (![newest, through, floor].every(Number.isFinite) || through <= floor)
    return undefined;
  const start = localQueryTimestampKeyExpression('r.effective_at');
  const finish = localQueryTimestampKeyExpression(
    "json_extract(r.payload_json, '$.endedAt')",
  );
  const r = await tx.execute(
    `SELECT r.effective_at AS start_at,
        json_extract(r.payload_json, '$.endedAt') AS end_at,
        json_extract(r.payload_json, '$.value.text') AS stage,
        json_array(json_extract(r.payload_json, '$.provenance.source.sourceIdentifier'),
          json_extract(r.payload_json, '$.provenance.source.productType'),
          json_extract(r.payload_json, '$.provenance.source.device.model'),
          json_extract(r.payload_json, '$.provenance.source.device.manufacturer'),
          json_extract(r.payload_json, '$.provenance.origin')) AS source
      FROM health_observations r
      WHERE ${currentEvidenceCondition('health_observation')}
        AND json_extract(r.payload_json, '$.concept') IN ('HKCategoryTypeIdentifierSleepAnalysis', 'sleep')
        AND json_extract(r.payload_json, '$.provenance.source.system') = 'healthkit'
        AND nullif(trim(json_extract(r.payload_json, '$.provenance.source.sourceIdentifier')), '') IS NOT NULL
        AND json_extract(r.payload_json, '$.value.kind') = 'text'
        AND json_extract(r.payload_json, '$.value.text') IN ('1','2','3','4','5','awake','asleepUnspecified','asleepREM','asleepCore','asleepDeep')
        AND ${start} >= ? AND ${start} < ? AND ${finish} > ${start}
      ORDER BY ${start} DESC LIMIT ?`,
    [
      localQueryTimestampKey(new Date(floor).toISOString()),
      localQueryTimestampKey(window.toExclusive),
      readLimit + 1,
    ],
  );
  // A truncated snapshot is not evidence of a complete episode.
  if (r.rows.length > readLimit) return undefined;
  const episode = projectLatestSleepEpisode(
    r.rows.flatMap(row => {
      const stage = overviewSleepStage(String(row.stage));
      const startAt = Date.parse(String(row.start_at));
      const endAt = Math.min(Date.parse(String(row.end_at)), through);
      return stage && typeof row.source === 'string'
        ? [{ stage, start: startAt, end: endAt, source: row.source }]
        : [];
    }),
  );
  // Don't show an older device episode if the actual latest reading lacked a reliable source.
  return episode && newest >= episode.from && newest < episode.to
    ? episode
    : undefined;
}
