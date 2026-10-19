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
const EVIDENCE_QUERY_CONCEPTS = [
  [['혈압', '수축기', '이완기'], 'blood pressure'],
  [['심박수', '심박', '맥박'], 'heart_rate'],
  [['걸음 수', '걸음'], 'step_count'],
  [['체중', '몸무게'], 'body_mass'],
  [['수면'], 'hkcategorytypeidentifiersleepanalysis'],
] as const;

// Summary, date, and lookup wording does not express a second evidence topic.
const GENERIC_MEASUREMENT_REQUEST_TERMS = new Set([
  '최근',
  '최신',
  '지난',
  '이번',
  '오늘',
  '어제',
  '기록',
  '측정',
  '데이터',
  '날짜',
  '시간',
  '수치',
  '값',
  '결과',
  '기간',
  '추이',
  '변화',
  '요약',
  '정리',
  '찾아',
  '검색',
  '조회',
  '확인',
  '알려',
  '보여',
  '주세요',
  '해주세요',
  '해줘',
  '부탁',
  '평균',
  '최고',
  '최저',
  '최대',
  '최소',
  '개수',
  '합계',
  '관련',
  '와',
  '과',
  '및',
  '또는',
  '그리고',
  '은',
  '는',
  '이',
  '가',
  '을',
  '를',
  '의',
  '에',
  '에서',
  '에게',
  '으로',
  '로',
  '도',
  '만',
  '까지',
  '부터',
  '들',
  '함께',
  '나타난',
]);

const KOREAN_QUERY_SUFFIXES = [
  '에서',
  '으로',
  '까지',
  '부터',
  '에게',
  '은',
  '는',
  '이',
  '가',
  '을',
  '를',
  '의',
  '와',
  '과',
  '도',
  '만',
  '에',
  '로',
  '해',
  '들',
] as const;

/** Maps Korean labels to the canonical concept keys used in structured measurement chunks. */
export function evidenceQueryAliases(query: string): string[] {
  const normalized = query.normalize('NFKC').toLowerCase();
  return EVIDENCE_QUERY_CONCEPTS.filter(([labels]) =>
    labels.some(label => normalized.includes(label)),
  ).map(([, concept]) => concept);
}

function isGenericMeasurementRequestTerm(term: string): boolean {
  if (GENERIC_MEASUREMENT_REQUEST_TERMS.has(term)) return true;
  return KOREAN_QUERY_SUFFIXES.some(
    suffix =>
      term.length > suffix.length &&
      term.endsWith(suffix) &&
      GENERIC_MEASUREMENT_REQUEST_TERMS.has(
        term.slice(0, term.length - suffix.length),
      ),
  );
}

function hasIntentBeyondMeasurement(query: string): boolean {
  let residual = query.normalize('NFKC').toLowerCase();
  for (const [labels] of EVIDENCE_QUERY_CONCEPTS) {
    for (const label of labels) residual = residual.replaceAll(label, ' ');
  }
  const terms = residual.match(/[\p{L}\p{M}\p{N}_]+/gu) ?? [];
  return terms.some(term => !isGenericMeasurementRequestTerm(term));
}

/** Adds stored measurement keys without discarding original terms from mixed searches. */
export function evidenceRagSearchQuery(query: string): string {
  const aliases = evidenceQueryAliases(query);
  if (aliases.length === 0) return query;
  if (!hasIntentBeyondMeasurement(query)) return aliases.join(' ');
  return `${aliases.join(' ')} ${query}`.trim();
}

export function evidenceQueryTerms(query: string): string[] {
  const normalized = query.normalize('NFKC').toLowerCase();
  const terms = new Set(normalized.match(/[\p{L}\p{M}\p{N}_]+/gu) ?? []);
  for (const concept of evidenceQueryAliases(query)) terms.add(concept);
  return [...terms];
}
