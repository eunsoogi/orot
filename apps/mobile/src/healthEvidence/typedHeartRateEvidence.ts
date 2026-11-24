import {
  isAppleDerivedHeartRateCategory,
  classifyAppleDerivedHeartRate,
  localQueryTimestampKey,
  localQueryTimestampKeyExpression,
  type AppleDerivedHeartRateCategory,
  type SqlDatabase,
  type SqlExecutor,
} from '@orot/storage';
import { typedHeartRateMaxRows, typedHeartRateMaxSourceBytes } from './typedHeartRateWindow';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import { currentEvidenceCondition } from './evidenceCandidateScope';
import {
  ensureHealthContextGeneration,
  readHealthContextGeneration,
} from './healthContext/generation';
import { checkHealthEvidenceAbort, decodeHealthEvidenceRecord } from './localEvidenceQueries';
import { readSelectedEvidenceRows } from './readSelectedEvidenceRows';

export type TypedHeartRateCategory = 'ordinary_average' | AppleDerivedHeartRateCategory;
type Period = { readonly fromInclusive: string; readonly toExclusive: string };
type Owner = { readonly current: () => boolean; readonly signal: AbortSignal };

type Evidence = Readonly<{
  category: TypedHeartRateCategory;
  period: Period;
  unit: 'BPM';
  meanBpm: number;
  sampleCount: number;
  /** The member-value digest includes rows with unchanged aggregate means. */
  membershipRevision: string;
  deletionGeneration: number;
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
    category: TypedHeartRateCategory | 'workout_heart_rate',
    { fromInclusive, toExclusive }: Period,
    owner: Owner,
  ): Promise<Evidence | null> => {
    const { signal, current } = owner;
    const active = () => !signal.aborted && current();
    if (!active()) return null;
    // Workout overlap and display-only aggregates are not proof of HealthKit association.
    if (category !== 'ordinary_average' && !isAppleDerivedHeartRateCategory(category)) return null;
    ready ??= database
      .execute('PRAGMA temp_store = MEMORY')
      .then(() => database.transaction(ensureHealthContextGeneration))
      .catch((error) => {
        ready = undefined;
        throw error;
      });
    await ready;
    if (!active()) return null;
    let snapshot: Awaited<ReturnType<typeof readTypedHeartRateSnapshot>> = null;
    await database.transaction(async (tx) => {
      if (!active()) return;
      snapshot = await readTypedHeartRateSnapshot(
        tx,
        category,
        { fromInclusive, toExclusive },
        signal,
      );
    });
    checkHealthEvidenceAbort(signal);
    const owned = snapshot as Awaited<ReturnType<typeof readTypedHeartRateSnapshot>>;
    if (!owned || !active()) return null;
    const { generation, ...evidence } = owned;
    const isCurrent = async () => {
      if (!active()) return false;
      try {
        const next = await readHealthContextGeneration(database);
        return (
          active() &&
          next.mutationGeneration === generation.mutationGeneration &&
          next.deletionGeneration === generation.deletionGeneration
        );
      } catch {
        return false;
      }
    };
    if (!(await isCurrent())) return null;
    return Object.freeze({ ...evidence, isCurrent });
  };
}

/** The same exact calculation runs on an already-owned transaction when retaining a citation. */
export async function readTypedHeartRateSnapshot(
  tx: SqlExecutor,
  category: TypedHeartRateCategory,
  { fromInclusive, toExclusive }: Period,
  signal?: AbortSignal,
  maximumCandidates?: number,
) {
  if (category !== 'ordinary_average' && !isAppleDerivedHeartRateCategory(category)) return null;
  const from = localQueryTimestampKey(fromInclusive);
  const to = localQueryTimestampKey(toExclusive);
  if (from >= to) throw new RangeError('Heart-rate period must advance.');
  const { condition, at, parameters } = typedHeartRateSelection(category, from, to);
  checkHealthEvidenceAbort(signal);
  let mean = 0;
  const sourceReferences: Evidence['sourceReferences'][number][] = [];
  const memberRevisions: Readonly<[string, string]>[] = [];
  const generation = await readHealthContextGeneration(tx);
  const query = `SELECT r.id, r.payload_json, length(CAST(r.payload_json AS BLOB)) AS payload_bytes
     FROM health_observations r WHERE ${condition} ORDER BY (${at}), r.id`;
  const { rows } = await readSelectedEvidenceRows(
    tx,
    maximumCandidates === undefined ? query : `SELECT * FROM (${query} LIMIT ?)`,
    maximumCandidates === undefined ? parameters : [...parameters, maximumCandidates + 1],
    signal,
  );
  if (maximumCandidates !== undefined && rows.length > maximumCandidates) return null;
  for (const row of rows) {
    const entry = decodeHealthEvidenceRecord('health_observation', row);
    if (entry.kind !== 'health_observation') continue;
    const { id, provenance, value } = entry.record;
    if (
      value.kind !== 'quantity' ||
      (category !== 'ordinary_average' && classifyAppleDerivedHeartRate(entry.record) !== category)
    )
      continue;
    memberRevisions.push([id, fingerprint(entry.record)]);
    // Keep exact observation membership and don't confuse a manual origin with a wearable measurement.
    sourceReferences.push(
      Object.freeze({
        observationId: id,
        sourceRecordIds: Object.freeze([...provenance.sourceRecordIds]),
        effectiveAt: entry.record.effectiveAt,
        origin: provenance.origin,
        ...(provenance.source ? { sourceSystem: provenance.source.system } : {}),
      }),
    );
    mean += (value.amount - mean) / sourceReferences.length;
  }
  checkHealthEvidenceAbort(signal);
  if (!sourceReferences.length || !Number.isFinite(mean)) return null;
  return Object.freeze({
    category,
    period: Object.freeze({ fromInclusive, toExclusive }),
    unit: 'BPM' as const,
    meanBpm: mean,
    sampleCount: sourceReferences.length,
    sourceReferences: Object.freeze(sourceReferences),
    membershipRevision: fingerprint(memberRevisions),
    deletionGeneration: generation.deletionGeneration,
    generation,
  });
}

function typedHeartRateSelection(category: TypedHeartRateCategory, from: string, to: string) {
  const at = localQueryTimestampKeyExpression('r.effective_at');
  // Exactly the same candidate membership is used for bounds and the complete read.
  const condition = `json_extract(r.payload_json, '$.concept') = ?
        AND json_extract(r.payload_json, '$.observationKind') = 'measurement'
        AND json_extract(r.payload_json, '$.value.kind') = 'quantity'
        AND json_extract(r.payload_json, '$.value.unit') = 'count/min'
        AND ${currentEvidenceCondition('health_observation')}
        AND (${at}) >= ? AND (${at}) < ?`;
  const concept = category === 'ordinary_average' ? 'heart_rate' : category;
  return { condition, at, parameters: [concept, from, to] };
}

/** No protected row contents cross the bridge if the entire explicit selection is too large. */
export async function typedHeartRateContextFits(
  tx: SqlExecutor,
  category: TypedHeartRateCategory,
  period: Period,
  signal?: AbortSignal,
) {
  const { condition, parameters } = typedHeartRateSelection(
    category,
    localQueryTimestampKey(period.fromInclusive),
    localQueryTimestampKey(period.toExclusive),
  );
  checkHealthEvidenceAbort(signal);
  const result = await tx.execute(
    `SELECT count(*) AS row_count, coalesce(sum(payload_bytes), 0) AS bytes FROM
      (SELECT length(CAST(r.payload_json AS BLOB)) AS payload_bytes
       FROM health_observations r WHERE ${condition} LIMIT ?)`,
    [...parameters, typedHeartRateMaxRows + 1],
  );
  checkHealthEvidenceAbort(signal);
  const row = result.rows[0];
  return (
    typeof row?.row_count === 'number' &&
    row.row_count <= typedHeartRateMaxRows &&
    typeof row.bytes === 'number' &&
    row.bytes <= typedHeartRateMaxSourceBytes
  );
}
