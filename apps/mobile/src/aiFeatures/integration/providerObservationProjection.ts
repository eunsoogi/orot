import { summarizeProviderSleep } from './providerObservationSleep';
import { compareTimestamps, TimestampSchema } from '@orot/domain';
import type { HealthObservation } from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceQueries';

export interface ProviderObservationSummary {
  readonly version: 1;
  readonly kind: 'sensor_period_summary';
  readonly coverage: 'retrieved_subset';
  readonly concept: string;
  readonly unit: string | null;
  readonly sourceLabel: string;
  readonly sampleCount: number;
  readonly period: {
    readonly fromInclusive: string;
    readonly toInclusive: string;
  };
  readonly statistics?: {
    readonly minimum: number;
    readonly maximum: number;
    readonly mean: number;
  };
  readonly sleep?: {
    readonly asleepSeconds: number;
    readonly coveredThroughExclusive: string | null;
    readonly overlappingStageSeconds: number;
    readonly stages: Readonly<Record<string, number>>;
  };
  readonly limitations: readonly string[];
}
export interface ProviderObservationGroup {
  /** Local citation glue only. Never serialize this outer object into a provider request. */
  readonly memberIds: readonly string[];
  readonly content: ProviderObservationSummary;
}

const sleepConcepts = new Set([
  'sleep',
  'HKCategoryTypeIdentifierSleepAnalysis',
]);
/** Classify typed time-series records, not every health record or only imported origins.
 * A manually entered numeric measurement is still a sample; narrative clinical records are not. */
export function isBulkSensorObservation(
  entry: LocalHealthEvidenceRecord,
): boolean {
  if (entry.kind !== 'health_observation') return false;
  const record = entry.record;
  if (['diagnosis', 'allergy', 'procedure'].includes(record.observationKind))
    return false;
  return (
    (record.observationKind === 'measurement' &&
      record.value.kind === 'quantity') ||
    sleepConcepts.has(record.concept) ||
    record.concept === 'workout_duration'
  );
}

function sourceKey(record: HealthObservation): string {
  // Preserve sensor/device distinctions locally without forwarding account or source identifiers.
  const source = record.provenance.source;
  return JSON.stringify([
    record.provenance.origin,
    source?.system,
    source?.sourceIdentifier,
    source?.productType,
    source?.device,
  ]);
}
function label(record: HealthObservation, ordinal: number): string {
  const system =
    record.provenance.source?.system === 'healthkit'
      ? 'healthkit'
      : 'other_source';
  const origin = ['imported', 'user_reported', 'derived'].includes(
    record.provenance.origin,
  )
    ? record.provenance.origin
    : 'other_origin';
  return `${system}:${origin}:group_${ordinal}`;
}

/** Deterministic local summary of the supplied current, authorized subset. This function
 * neither retrieves more data nor grants consent. Consumers serialize content only and
 * retain memberIds locally for freshness/deletion validation and citation restoration. */
export function summarizeProviderObservations(
  entries: readonly LocalHealthEvidenceRecord[],
): readonly ProviderObservationGroup[] {
  const groups = new Map<string, Map<string, HealthObservation>>();
  const identities = new Map<string, string>();
  for (const entry of entries) {
    if (!isBulkSensorObservation(entry) || entry.kind !== 'health_observation')
      continue;
    const record = entry.record;
    const identity = JSON.stringify(record);
    if (identities.has(record.id) && identities.get(record.id) !== identity)
      throw new Error('Conflicting observation identity.');
    identities.set(record.id, identity);
    if (
      !TimestampSchema.safeParse(record.effectiveAt).success ||
      (record.endedAt !== undefined &&
        (!TimestampSchema.safeParse(record.endedAt).success ||
          compareTimestamps(record.endedAt, record.effectiveAt) < 0))
    ) {
      throw new Error('Invalid observation period.');
    }
    const key = JSON.stringify([
      record.concept,
      record.value.kind === 'quantity' ? record.value.unit : null,
      sourceKey(record),
    ]);
    const group = groups.get(key) ?? new Map<string, HealthObservation>();
    if (
      group.has(record.id) &&
      JSON.stringify(group.get(record.id)) !== JSON.stringify(record)
    )
      throw new Error('Conflicting observation identity.');
    group.set(record.id, record);
    groups.set(key, group);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group], index) => {
      const records = [...group.values()].sort(
        (a, b) =>
          compareTimestamps(a.effectiveAt, b.effectiveAt) ||
          a.id.localeCompare(b.id),
      );
      const first = records[0]!;
      const limitations = [
        'retrieved_subset_not_complete_history',
        'descriptive_statistics_not_diagnosis',
        'sensor_sources_not_merged',
        'missing_samples_are_unknown_not_zero',
      ];
      // Same-source, same-instant disagreements are not silently presented as a clean mean.
      if (
        records.some((record, position) => {
          const previous = records[position - 1];
          return (
            previous &&
            record.value.kind === 'quantity' &&
            previous.value.kind === 'quantity' &&
            compareTimestamps(previous.effectiveAt, record.effectiveAt) === 0 &&
            previous.value.amount !== record.value.amount
          );
        })
      )
        limitations.push('conflicting_values_at_same_instant');
      const quantities = records.flatMap(record =>
        record.value.kind === 'quantity' ? [record.value.amount] : [],
      );
      if (
        quantities.length !== records.length &&
        !sleepConcepts.has(first.concept)
      )
        limitations.push(
          'unsupported_sample_value_representation_not_interpreted',
        );
      if (quantities.some(value => !Number.isFinite(value)))
        throw new Error('Invalid observation quantity.');
      const statistics = quantities.length
        ? {
            minimum: quantities.reduce((a, b) => Math.min(a, b)),
            maximum: quantities.reduce((a, b) => Math.max(a, b)),
            // Weighted terms avoid an overflowing sum even for individually finite stored quantities.
            mean: quantities.reduce(
              (sum, value) => sum + value / quantities.length,
              0,
            ),
          }
        : undefined;
      if (statistics && !Number.isFinite(statistics.mean))
        throw new Error('Invalid summarized observation quantity.');
      return {
        memberIds: records.map(record => record.id),
        content: {
          version: 1,
          kind: 'sensor_period_summary',
          coverage: 'retrieved_subset',
          concept: first.concept,
          unit: first.value.kind === 'quantity' ? first.value.unit : null,
          sourceLabel: label(first, index + 1),
          sampleCount: records.length,
          period: {
            fromInclusive: first.effectiveAt,
            toInclusive: records.at(-1)!.effectiveAt,
          },
          ...(statistics ? { statistics } : {}),
          ...(sleepConcepts.has(first.concept)
            ? { sleep: summarizeProviderSleep(records, limitations) }
            : {}),
          limitations: [...new Set(limitations)],
        },
      };
    });
}
