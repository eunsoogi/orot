import {
  isAppleDerivedHeartRateCategory,
  classifyAppleDerivedHeartRate,
  localQueryTimestampKey,
  localQueryTimestampKeyExpression,
  type AppleDerivedHeartRateCategory,
  type SqlDatabase,
} from '@orot/storage';
import { currentEvidenceCondition } from './evidenceCandidateScope';
import {
  ensureHealthContextGeneration,
  readHealthContextGeneration,
} from './healthContext/generation';
import {
  checkHealthEvidenceAbort,
  decodeHealthEvidenceRecord,
} from './localEvidenceQueries';
import { readSelectedEvidenceRows } from './readSelectedEvidenceRows';

type Category = 'ordinary_average' | AppleDerivedHeartRateCategory;
type Period = { readonly fromInclusive: string; readonly toExclusive: string };
type Owner = { readonly current: () => boolean; readonly signal: AbortSignal };
type Generation = Awaited<ReturnType<typeof readHealthContextGeneration>>;

type Evidence = Readonly<{
  category: Category;
  period: Period;
  unit: 'BPM';
  meanBpm: number;
  sampleCount: number;
  sourceReferences: readonly Readonly<{
    observationId: string;
    sourceRecordIds: readonly string[];
    effectiveAt: string;
    origin: string;
    sourceSystem?: string;
  }>[];
  /** The downstream caller must re-prove freshness before using this local snapshot. */
  isCurrent(): Promise<boolean>;
}>;

/** Explicit same-owner local read; never consumed by generic search or a provider registry. */
export function createTypedHeartRateEvidenceReader(database: SqlDatabase) {
  let ready: Promise<void> | undefined;
  return async (
    category: Category | 'workout_heart_rate',
    { fromInclusive, toExclusive }: Period,
    owner: Owner,
  ): Promise<Evidence | null> => {
    const { signal, current } = owner;
    const active = () => !signal.aborted && current();
    if (!active()) return null;
    // Workout overlap and display-only aggregates are not proof of HealthKit association.
    if (
      category !== 'ordinary_average' &&
      !isAppleDerivedHeartRateCategory(category)
    )
      return null;
    const from = localQueryTimestampKey(fromInclusive);
    const to = localQueryTimestampKey(toExclusive);
    if (from >= to) throw new RangeError('Heart-rate period must advance.');
    const concept = category === 'ordinary_average' ? 'heart_rate' : category;
    const at = localQueryTimestampKeyExpression('r.effective_at');
    ready ??= database
      .execute('PRAGMA temp_store = MEMORY')
      .then(() => database.transaction(ensureHealthContextGeneration))
      .catch(error => {
        ready = undefined;
        throw error;
      });
    await ready;
    if (!active()) return null;
    let generation: Generation | undefined;
    let mean = 0;
    const sourceReferences: Evidence['sourceReferences'][number][] = [];
    await database.transaction(async tx => {
      if (!active()) return;
      generation = await readHealthContextGeneration(tx);
      const { rows } = await readSelectedEvidenceRows(
        tx,
        `SELECT r.id, r.payload_json, length(CAST(r.payload_json AS BLOB)) AS payload_bytes
          FROM health_observations r
          WHERE json_extract(r.payload_json, '$.concept') = ?
            AND json_extract(r.payload_json, '$.observationKind') = 'measurement'
            AND json_extract(r.payload_json, '$.value.kind') = 'quantity'
            AND json_extract(r.payload_json, '$.value.unit') = 'count/min'
            AND ${currentEvidenceCondition('health_observation')}
            AND (${at}) >= ? AND (${at}) < ?
          ORDER BY (${at}), r.id`,
        [concept, from, to],
        signal,
      );
      for (const row of rows) {
        const entry = decodeHealthEvidenceRecord('health_observation', row);
        if (entry.kind !== 'health_observation') continue;
        const { id, provenance, value } = entry.record;
        if (
          value.kind !== 'quantity' ||
          (category !== 'ordinary_average' &&
            classifyAppleDerivedHeartRate(entry.record) !== category)
        )
          continue;
        // Keep exact observation membership and don't confuse a manual origin with a wearable measurement.
        sourceReferences.push(
          Object.freeze({
            observationId: id,
            sourceRecordIds: Object.freeze([...provenance.sourceRecordIds]),
            effectiveAt: entry.record.effectiveAt,
            origin: provenance.origin,
            ...(provenance.source
              ? { sourceSystem: provenance.source.system }
              : {}),
          }),
        );
        mean += (value.amount - mean) / sourceReferences.length;
      }
    });
    checkHealthEvidenceAbort(signal);
    if (
      !generation ||
      !sourceReferences.length ||
      !Number.isFinite(mean) ||
      !active()
    )
      return null;
    const isCurrent = async () => {
      if (!active()) return false;
      try {
        const next = await readHealthContextGeneration(database);
        return (
          active() &&
          next.mutationGeneration === generation?.mutationGeneration &&
          next.deletionGeneration === generation?.deletionGeneration
        );
      } catch {
        return false;
      }
    };
    if (!(await isCurrent())) return null;
    return Object.freeze({
      category,
      period: Object.freeze({ fromInclusive, toExclusive }),
      unit: 'BPM',
      meanBpm: mean,
      sampleCount: sourceReferences.length,
      sourceReferences: Object.freeze(sourceReferences),
      isCurrent,
    });
  };
}
