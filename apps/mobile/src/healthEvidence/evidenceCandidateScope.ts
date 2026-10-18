import {
  localQueryTimestampKey,
  localQueryTimestampKeyExpression,
} from '@orot/storage';
import type { RecordKind, SqlValue } from '@orot/storage';

export interface EvidenceCandidateScope {
  /** Internal local source IDs; provider-facing aliases must be resolved before this boundary. */
  readonly sourceIds?: readonly string[];
  readonly timeRange?: {
    readonly fromInclusive: string;
    readonly toExclusive: string;
  };
}

/** Uses only fixed record aliases and typed kind constants in SQL expressions. */
export function currentEvidenceCondition(kind: RecordKind): string {
  const notStale = `NOT EXISTS (SELECT 1 FROM transcript_artifact_staleness stale
    WHERE stale.artifact_kind = '${kind}' AND stale.artifact_id = r.id)`;
  if (kind !== 'transcript_segment') return notStale;
  return `${notStale} AND NOT EXISTS (SELECT 1 FROM transcript_segments newer
    WHERE json_extract(newer.payload_json, '$.transcriptId') = json_extract(r.payload_json, '$.transcriptId')
      AND json_extract(newer.payload_json, '$.revision') > json_extract(r.payload_json, '$.revision'))`;
}

/** Applies source and exact-instant constraints before ranking, never after selecting a page. */
export function candidateScopeCondition(
  kind: RecordKind,
  scope?: EvidenceCandidateScope,
) {
  const clauses = [currentEvidenceCondition(kind)];
  const parameters: SqlValue[] = [];
  if (scope?.sourceIds) {
    if (!scope.sourceIds.length) clauses.push('0 = 1');
    else {
      const placeholders = scope.sourceIds.map(() => '?').join(', ');
      const source =
        kind === 'source_record'
          ? 'r.id'
          : kind === 'evidence_span'
            ? "json_extract(r.payload_json, '$.sourceRecordId')"
            : kind === 'transcript_segment'
              ? "json_extract(r.payload_json, '$.recordingSourceId')"
              : "COALESCE(json_extract(r.payload_json, '$.provenance.sourceRecordIds[0]'), r.id)";
      clauses.push(`${source} IN (${placeholders})`);
      parameters.push(...scope.sourceIds);
    }
  }
  if (scope?.timeRange) {
    const from = localQueryTimestampKey(scope.timeRange.fromInclusive);
    const to = localQueryTimestampKey(scope.timeRange.toExclusive);
    if (from >= to) throw new RangeError('Evidence time range must advance.');
    const time = localQueryTimestampKeyExpression('r.effective_at');
    clauses.push(
      `r.effective_at IS NOT NULL AND (${time}) >= ? AND (${time}) < ?`,
    );
    parameters.push(from, to);
  }
  return { sql: clauses.join(' AND '), parameters };
}

/** Mirrors imported concept names so Korean queries can rank their persisted measurements. */
export function evidenceQueryTerms(query: string): string[] {
  const normalized = query.normalize('NFKC').toLowerCase();
  const terms = new Set(normalized.match(/[\p{L}\p{M}\p{N}_]+/gu) ?? []);
  for (const [labels, concept] of [
    [['혈압', '수축기', '이완기'], 'blood pressure'],
    [['심박', '맥박'], 'heart_rate'],
    [['걸음'], 'step_count'],
    [['체중', '몸무게'], 'body_mass'],
    [['수면'], 'hkcategorytypeidentifiersleepanalysis'],
  ] as const) {
    if (labels.some(label => normalized.includes(label))) terms.add(concept);
  }
  return [...terms];
}
