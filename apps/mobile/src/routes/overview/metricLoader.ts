import { t } from '../../i18n';
import {
  localQueryTimestampKey,
  localQueryTimestampKeyExpression,
} from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { currentEvidenceCondition } from '../../healthEvidence/evidenceCandidateScope';
import { readOverviewMetricSnapshot } from './metricReadCancellation';
import { readOverviewChartHealthContext } from '../../healthEvidence/healthContext/healthContextReport';
import { overviewMetrics, type OverviewMetric } from './metricSelection';
import {
  projectOverviewMetric,
  type OverviewMetricProjection,
} from './metricProjection';

/** The calendar window includes fourteen completed days and today's partial day, including DST changes. */
export function overviewMetricWindow(now: Date) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 14);
  return {
    fromInclusive: start.toISOString(),
    toExclusive: now.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** Local-only snapshot: aggregate and source metadata share one transaction and never initiate a sync. */
export async function loadOverviewMetrics(
  database: SqlDatabase,
  now = new Date(),
  signal?: AbortSignal,
): Promise<{
  metrics: Partial<Record<OverviewMetric, OverviewMetricProjection>>;
  quantityTruncated: boolean;
}> {
  if (signal?.aborted) throw new Error('Overview metric read was cancelled.');
  const window = overviewMetricWindow(now);
  const results: Partial<Record<OverviewMetric, OverviewMetricProjection>> = {};
  let quantityTruncated = false;
  // Prevent SQLite from writing derived health aggregates into temporary files.
  await database.execute('PRAGMA temp_store = MEMORY');
  await readOverviewMetricSnapshot(database, signal, async tx => {
    const report = await readOverviewChartHealthContext(tx, window);
    quantityTruncated = report.limitations.includes(
      'quantity_sensor_series_limit_reached',
    );
    const at = localQueryTimestampKeyExpression('r.effective_at');
    const end = localQueryTimestampKeyExpression(
      "json_extract(r.payload_json, '$.endedAt')",
    );
    const sourceFields = `lower(json_extract(r.payload_json, '$.concept')) AS concept,
      json_extract(r.payload_json, '$.value.unit') AS unit,
      COALESCE(json_extract(r.payload_json, '$.provenance.source.sourceIdentifier'), json_extract(r.payload_json, '$.provenance.origin')) || ':' ||
        COALESCE(json_extract(r.payload_json, '$.provenance.source.productType'), json_extract(r.payload_json, '$.provenance.source.device.model'), '') AS sensor,
      json_extract(r.payload_json, '$.provenance.source.sourceName') AS name,
      json_extract(r.payload_json, '$.provenance.source.sourceIdentifier') AS identifier`;
    const current = currentEvidenceCondition('health_observation');
    // Quantity timestamps come from the aggregate. Deduplicate only the fields
    // used for source labels and compatibility so dense samples need no ranking.
    // Sleep still needs the latest original timestamp for each source.
    const names = await tx.execute(
      `SELECT * FROM (
      WITH quantity_sources AS (
        SELECT DISTINCT ${sourceFields}
        FROM health_observations r WHERE ${current}
          AND json_extract(r.payload_json, '$.concept') IN ('heart_rate', 'body_mass', 'weight', 'step_count', 'workout_duration')
          AND ${at} >= ? AND ${at} < ?
          AND json_extract(r.payload_json, '$.value.kind') = 'quantity'
          AND json_type(r.payload_json, '$.value.amount') IN ('integer', 'real')
      ), sleep_candidates AS (
        SELECT ${sourceFields}, r.effective_at AS measured_at, ${at} AS at_key
        FROM health_observations r WHERE ${current}
          AND json_extract(r.payload_json, '$.concept') IN ('HKCategoryTypeIdentifierSleepAnalysis', 'sleep')
          AND ${at} < ? AND ${end} > ?
          AND julianday(json_extract(r.payload_json, '$.endedAt')) > julianday(r.effective_at)
          AND json_extract(r.payload_json, '$.value.text') IN ('1','3','4','5','asleepUnspecified','asleepCore','asleepDeep','asleepREM')
      ), ranked_sleep AS (
        SELECT *, row_number() OVER (PARTITION BY concept, unit, sensor, name, identifier ORDER BY at_key DESC) AS rank
        FROM sleep_candidates
      )
      SELECT concept, unit, sensor, name, identifier, measured_at FROM ranked_sleep WHERE rank = 1
      UNION ALL
      SELECT concept, unit, sensor, name, identifier, NULL AS measured_at FROM quantity_sources)`,
      [
        localQueryTimestampKey(window.fromInclusive),
        localQueryTimestampKey(window.toExclusive),
        localQueryTimestampKey(window.toExclusive),
        localQueryTimestampKey(window.fromInclusive),
      ],
    );
    const complete = report.days.filter(day => !day.partial);
    let sleepSourcesCompatible = false;
    if (complete.length >= 14) {
      const previous = complete.slice(-14, -7);
      const recent = complete.slice(-7);
      const sources = await tx.execute(
        `SELECT DISTINCT w.period, json_extract(r.payload_json, '$.provenance.source.sourceIdentifier') AS identifier,
          COALESCE(json_extract(r.payload_json, '$.provenance.source.productType'), json_extract(r.payload_json, '$.provenance.source.device.model'), '') AS device
         FROM health_observations r JOIN (SELECT 'previous' AS period, ? AS start_key, ? AS end_key UNION ALL SELECT 'recent', ?, ?) w
           ON ${at} < w.end_key AND ${end} > w.start_key
         WHERE ${currentEvidenceCondition('health_observation')}
           AND json_extract(r.payload_json, '$.concept') IN ('HKCategoryTypeIdentifierSleepAnalysis', 'sleep')
           AND julianday(json_extract(r.payload_json, '$.endedAt')) > julianday(r.effective_at)
           AND json_extract(r.payload_json, '$.value.text') IN ('1','3','4','5','asleepUnspecified','asleepCore','asleepDeep','asleepREM')`,
        [
          previous[0]!.fromInclusive,
          previous.at(-1)!.toExclusive,
          recent[0]!.fromInclusive,
          recent.at(-1)!.toExclusive,
        ].map(localQueryTimestampKey),
      );
      const sourceSet = (period: string) =>
        sources.rows
          .filter(row => row.period === period)
          .map(row =>
            typeof row.identifier === 'string' && row.identifier
              ? `${row.identifier}\u0000${row.device}`
              : '',
          )
          .sort();
      const before = sourceSet('previous');
      const after = sourceSet('recent');
      sleepSourcesCompatible =
        before.length > 0 &&
        !before.includes('') &&
        JSON.stringify(before) === JSON.stringify(after);
    }
    for (const metric of overviewMetrics) {
      const concept = {
        sleep: 'sleep',
        heartRate: 'heart_rate',
        bodyMass: 'body_mass',
        steps: 'step_count',
        workouts: 'workout_duration',
      }[metric];
      const unit = {
        sleep: 'min',
        heartRate: 'count/min',
        bodyMass: 'kg',
        steps: 'count',
        workouts: 'min',
      }[metric];
      const series = report.quantities.find(
        item => item.concept === concept && item.unit === unit,
      );
      const matching = names.rows.filter(row =>
        metric === 'sleep'
          ? row.concept === 'sleep' ||
            row.concept === 'hkcategorytypeidentifiersleepanalysis'
          : (row.concept === concept ||
              (metric === 'bodyMass' && row.concept === 'weight')) &&
            row.unit === unit &&
            row.sensor === series?.source,
      );
      const sourceNames = [
        ...new Set(
          matching
            .map(row => row.name)
            .filter(
              (name): name is string =>
                typeof name === 'string' && !!name.trim(),
            ),
        ),
      ].sort();
      if (
        matching.some(row => typeof row.name !== 'string' || !row.name.trim())
      )
        sourceNames.push(t('overview.sourceUnknown'));
      const sleepTime =
        matching
          .map(row => row.measured_at)
          .filter((time): time is string => typeof time === 'string')
          .sort((a, b) => Date.parse(a) - Date.parse(b))
          .at(-1) ?? null;
      const result = projectOverviewMetric(
        report,
        metric,
        sourceNames.join(', ') || t('overview.sourceUnknown'),
        sleepTime,
      );
      const incompatibleQuantity =
        metric !== 'sleep' &&
        (!matching.length ||
          matching.some(
            row => typeof row.identifier !== 'string' || !row.identifier,
          ) ||
          names.rows.some(
            row =>
              (row.concept === concept ||
                (metric === 'bodyMass' && row.concept === 'weight')) &&
              row.sensor === series?.source &&
              row.unit !== unit,
          ));
      if (result)
        results[metric] =
          (metric === 'sleep' && !sleepSourcesCompatible) ||
          incompatibleQuantity
            ? { ...result, comparison: null }
            : result;
    }
  });
  return { metrics: results, quantityTruncated };
}
