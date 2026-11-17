import { t } from '../i18n';
import { overviewConcepts, type OverviewRow } from './summaryOverviewConcepts';
import type { JsonValue } from '@orot/model-runtime';
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Bind app-computed groups as aggregates, never fabricate an individual observation from their mean. */
export function sensorOverviewRow(value: unknown): OverviewRow | undefined {
  if (
    !object(value) ||
    value.kind !== 'sensor_period_summary' ||
    value.version !== 1 ||
    value.coverage !== 'retrieved_subset' ||
    typeof value.concept !== 'string' ||
    typeof value.unit !== 'string' ||
    !object(value.statistics) ||
    !object(value.period) ||
    !Number.isSafeInteger(value.sampleCount) ||
    Number(value.sampleCount) < 1
  )
    return;
  const { minimum, maximum, mean } = value.statistics;
  const { fromInclusive: from, toInclusive: to } = value.period;
  if (
    ![minimum, maximum, mean].every(
      n => typeof n === 'number' && Number.isFinite(n),
    ) ||
    Number(minimum) > Number(mean) ||
    Number(mean) > Number(maximum) ||
    typeof from !== 'string' ||
    typeof to !== 'string' ||
    !Number.isFinite(Date.parse(from)) ||
    !Number.isFinite(Date.parse(to)) ||
    Date.parse(from) > Date.parse(to)
  )
    return;
  const spec = Object.hasOwn(overviewConcepts, value.concept)
    ? overviewConcepts[value.concept]
    : undefined;
  const label = spec?.label ?? value.concept;
  const unit = spec?.sourceUnit === value.unit ? spec.displayUnit : value.unit;
  return {
    label,
    amount: Number(mean),
    unit,
    raw: value as JsonValue,
    summaryText:
      t('computedTopic.sensorSubset', {
        label,
        count: Number(value.sampleCount),
        mean: Number(mean),
        minimum: Number(minimum),
        maximum: Number(maximum),
        unit,
        from,
        to,
      }) +
      (Array.isArray(value.limitations) &&
      value.limitations.includes('conflicting_values_at_same_instant')
        ? ` ${t('computedTopic.conflictingMeasurements')}`
        : ''),
  };
}

/** Typed validation anchors preserve the distinction between sample counts and measured statistics. */
export function sensorSummaryFacts(values: unknown): Record<string, unknown>[] {
  if (!Array.isArray(values)) return [];
  return values.flatMap(value => {
    const row = sensorOverviewRow(value);
    if (!row || !object(value) || !object(value.statistics)) return [];
    return [
      {
        kind: 'health_context_quantity',
        concept: value.concept,
        unit: value.unit,
        sampleCount: value.sampleCount,
        amounts: [
          value.statistics.minimum,
          value.statistics.maximum,
          value.statistics.mean,
        ],
      },
    ];
  });
}
