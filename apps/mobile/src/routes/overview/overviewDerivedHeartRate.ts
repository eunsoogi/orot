import {
  appleDerivedHeartRatePredicate,
  localQueryTimestampKeyExpression,
  type SqlExecutor,
} from '@orot/storage';
import { t } from '../../i18n';
import { currentEvidenceCondition } from '../../healthEvidence/evidenceCandidateScope';
import {
  healthContextCalendarParameter,
  healthContextCalendarSql,
} from '../../healthEvidence/healthContext/calendarSql';
import type { OverviewChartHealthContext } from '../../healthEvidence/healthContext/healthContextReport';
import type { HealthQuantityDay } from '../../healthEvidence/healthContext/types';
import { projectOverviewMetric } from './metricProjection';

const concepts = {
  restingHeartRate: 'resting_heart_rate',
  walkingHeartRate: 'walking_heart_rate_average',
} as const;

/** Load only a selected Apple-derived metric from the owning chart snapshot.
 * The exact importer predicate rejects generic BPM, unverified provenance and
 * spoofed category labels. Never mix two sensors or absence with zero.
 */
export async function projectOverviewDerivedHeartRate(
  tx: SqlExecutor,
  report: OverviewChartHealthContext,
  metric: keyof typeof concepts,
) {
  const concept = concepts[metric];
  const at = localQueryTimestampKeyExpression('r.effective_at');
  const end = localQueryTimestampKeyExpression(
    "json_extract(r.payload_json, '$.endedAt')",
  );
  const stats = (name: string) =>
    `json_extract(r.payload_json, '$.heartRateSampleSummary.${name}')`;
  const useSummary = `${end} >= ${at} AND ${end} < days.to_key
    AND json_type(r.payload_json, '$.heartRateSampleSummary.count') = 'integer'
    AND ${stats('count')} BETWEEN 2 AND 1000000
    AND ${stats('mean')} = json_extract(r.payload_json, '$.value.amount')
    AND ${stats('minimum')} > 0 AND ${stats('minimum')} <= ${stats('mean')}
    AND ${stats('maximum')} >= ${stats('mean')}`;
  const result = await tx.execute(
    `SELECT * FROM (WITH days(date, from_key, to_key) AS (${healthContextCalendarSql}),
      measures AS MATERIALIZED (
        SELECT days.date, r.id, r.effective_at AS at, ${at} AS at_key, ${end} AS end_key,
          json_extract(r.payload_json, '$.value.amount') AS bpm,
          CASE WHEN ${useSummary} THEN ${stats('count')} ELSE 1 END AS weight,
          CASE WHEN ${useSummary} THEN ${stats('minimum')} ELSE json_extract(r.payload_json, '$.value.amount') END AS low,
          CASE WHEN ${useSummary} THEN ${stats('maximum')} ELSE json_extract(r.payload_json, '$.value.amount') END AS high,
          json_extract(r.payload_json, '$.provenance.source.sourceName') AS name,
          CASE WHEN NULLIF(json_extract(r.payload_json, '$.provenance.source.sourceIdentifier'), '') IS NULL
            THEN json_array('unidentified', r.id)
            ELSE json_array(json_extract(r.payload_json, '$.provenance.source.sourceIdentifier'),
            json_extract(r.payload_json, '$.provenance.source.productType'),
            json_extract(r.payload_json, '$.provenance.source.device.model')
          ) END AS sensor
        FROM days CROSS JOIN health_observations r
        WHERE ${at} >= days.from_key AND ${at} < days.to_key
          AND ${currentEvidenceCondition('health_observation')}
          AND ${appleDerivedHeartRatePredicate(concept)}
          AND json_extract(r.payload_json, '$.observationKind') = 'measurement'
          AND json_type(r.payload_json, '$.value.amount') IN ('integer', 'real')
          AND json_extract(r.payload_json, '$.value.amount') > 0
      ), neighbors AS (
        SELECT *,
          max(COALESCE(end_key, at_key)) OVER (
            PARTITION BY date, sensor ORDER BY at_key, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ) AS prev_end,
          lead(at_key) OVER (PARTITION BY date, sensor ORDER BY at_key, id) AS next_start
        FROM measures
      ), disjoint AS (
        SELECT *, (prev_end IS NULL OR prev_end < at_key)
          AND (next_start IS NULL OR next_start > end_key) AS safe_interval
        FROM neighbors
      ), winner AS (
        SELECT sensor FROM measures GROUP BY sensor ORDER BY count(*) DESC, sensor LIMIT 1
      ), ranked AS (
        SELECT *, row_number() OVER (PARTITION BY date ORDER BY at_key DESC, id) AS newest,
          row_number() OVER (PARTITION BY date ORDER BY at_key, id) AS oldest
        FROM disjoint JOIN winner USING (sensor)
      )
      SELECT date,
        sum(CASE WHEN safe_interval THEN weight ELSE 1 END) AS samples,
        min(CASE WHEN safe_interval THEN low ELSE bpm END) AS minimum,
        max(CASE WHEN safe_interval THEN high ELSE bpm END) AS maximum,
        sum(bpm * CASE WHEN safe_interval THEN weight ELSE 1 END)
          / CAST(sum(CASE WHEN safe_interval THEN weight ELSE 1 END) AS REAL) AS mean,
        sum(bpm * CASE WHEN safe_interval THEN weight ELSE 1 END) AS total,
        max(CASE WHEN newest = 1 THEN bpm END) AS latest,
        max(CASE WHEN newest = 1 THEN at END) AS last_at,
        max(CASE WHEN oldest = 1 THEN at END) AS first_at, min(name) AS name
      FROM ranked GROUP BY date ORDER BY date)`,
    [healthContextCalendarParameter(report.days)],
  );
  if (result.rows.length === 0) return null;
  const days: HealthQuantityDay[] = [];
  const sources = new Set<string>();
  for (const row of result.rows) {
    const { date, samples, minimum, maximum, mean, total, latest } = row;
    const firstAt = row.first_at;
    const lastAt = row.last_at;
    if (
      typeof date !== 'string' ||
      typeof firstAt !== 'string' ||
      typeof lastAt !== 'string' ||
      ![samples, minimum, maximum, mean, total, latest].every(
        value => typeof value === 'number' && Number.isFinite(value),
      )
    )
      throw new Error('Invalid derived heart-rate aggregate.');
    days.push({
      date,
      samples: Number(samples),
      minimum: Number(minimum),
      maximum: Number(maximum),
      mean: Number(mean),
      sum: Number(total),
      latest: Number(latest),
      firstAt,
      lastAt,
    });
    if (typeof row.name === 'string' && row.name.trim()) sources.add(row.name);
  }
  const source = [...sources].sort().join(', ') || t('overview.sourceUnknown');
  const projected = projectOverviewMetric(
    {
      ...report,
      quantities: [{ concept, unit: 'count/min', source, days }],
    },
    metric,
    source,
  );
  // This narrow snapshot does not establish week-to-week source equivalence.
  return projected && { ...projected, comparison: null };
}
