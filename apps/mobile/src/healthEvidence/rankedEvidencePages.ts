import {
  STORAGE_TABLES,
  localQueryTimestampKeyExpression,
} from '@orot/storage';
import {
  candidateScopeCondition,
  evidenceQueryTerms,
} from './evidenceCandidateScope';
import type { EvidenceCandidateScope } from './evidenceCandidateScope';
import type { RecordKind, SqlExecutor, SqlValue } from '@orot/storage';
import {
  appendHealthEvidenceRows,
  checkHealthEvidenceAbort,
  MAX_HEALTH_EVIDENCE_RECORD_BYTES,
} from './localEvidenceQueries';
import type { LocalHealthEvidenceRecord } from './localEvidenceQueries';
import { HEALTH_OVERVIEW_PRIORITY_SQL } from './healthOverviewScope';

export interface RankedEvidenceCursor {
  readonly score: number;
  readonly timeKey: string;
  readonly diversityRank: number;
  readonly id: string;
}

export interface RankedEvidencePage {
  readonly records: readonly LocalHealthEvidenceRecord[];
  readonly nextCursor: RankedEvidenceCursor | null;
  /** Unsafe payloads were omitted; a remaining ranked page alone is not a coverage gap. */
  readonly incomplete: boolean;
}

/**
 * Ranks within SQL, crossing only one bounded payload page into JavaScript.
 * Matching text precedes recency; equal ranks use time and ID for stable paging.
 * A cursor belongs to the same kind/query and does not promise snapshot isolation
 * across concurrent edits. Callers must revalidate selected citations separately.
 */
export async function readRankedEvidencePage(
  executor: SqlExecutor,
  kind: RecordKind,
  query: string,
  options: {
    readonly limit?: number;
    readonly cursor?: RankedEvidenceCursor | null;
    readonly signal?: AbortSignal;
    readonly scope?: EvidenceCandidateScope;
  } = {},
): Promise<RankedEvidencePage> {
  checkHealthEvidenceAbort(options.signal);
  const limit = options.limit ?? 16;
  if (
    !Object.hasOwn(STORAGE_TABLES, kind) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    query.length > 1000
  ) {
    throw new RangeError('Invalid ranked evidence page request.');
  }
  // Literal query values are bound, including app-owned translations of stored concept names.
  const terms = evidenceQueryTerms(query);
  const score =
    options.scope?.selection === 'health_overview' &&
    kind === 'health_observation'
      ? HEALTH_OVERVIEW_PRIORITY_SQL
      : terms.length
        ? terms
            .map(
              () =>
                'CASE WHEN instr(lower(r.payload_json), ?) > 0 THEN 1 ELSE 0 END',
            )
            .join(' + ')
        : '0';
  const cursor = options.cursor;
  const scope = candidateScopeCondition(kind, options.scope);
  const parameters: SqlValue[] = [
    MAX_HEALTH_EVIDENCE_RECORD_BYTES,
    ...(options.scope?.selection === 'health_overview' &&
    kind === 'health_observation'
      ? []
      : terms),
    ...scope.parameters,
  ];
  if (cursor) {
    if (
      !Number.isSafeInteger(cursor.score) ||
      cursor.score < 0 ||
      typeof cursor.timeKey !== 'string' ||
      !Number.isSafeInteger(cursor.diversityRank) ||
      cursor.diversityRank < 1 ||
      typeof cursor.id !== 'string'
    ) {
      throw new RangeError('Invalid ranked evidence cursor.');
    }
    parameters.push(
      cursor.score,
      cursor.score,
      cursor.diversityRank,
      cursor.score,
      cursor.diversityRank,
      cursor.timeKey,
      cursor.score,
      cursor.diversityRank,
      cursor.timeKey,
      cursor.id,
    );
  }
  parameters.push(limit + 1);
  const time = localQueryTimestampKeyExpression('r.effective_at');
  // Window ranking carries only IDs and sort keys, never the full payload corpus.
  // With no specific query, each observation concept gets a turn before dense kinds repeat.
  const diversity =
    kind === 'health_observation'
      ? 'row_number() OVER (PARTITION BY concept ORDER BY score DESC, sort_time DESC, id ASC)'
      : '1';
  const result = await executor.execute(
    `SELECT r.id, ranked.score, ranked.sort_time, ranked.diversity_rank,
       CASE WHEN length(CAST(r.payload_json AS BLOB)) <= ? THEN r.payload_json ELSE NULL END AS payload_json,
       length(CAST(r.payload_json AS BLOB)) AS payload_bytes
     FROM ${STORAGE_TABLES[kind].table} r JOIN (
       SELECT id, score, sort_time, ${diversity} AS diversity_rank FROM (
         SELECT r.id, (${score}) AS score,
           CASE WHEN r.effective_at IS NULL THEN '' ELSE (${time}) END AS sort_time,
           json_extract(r.payload_json, '$.concept') AS concept
         FROM ${STORAGE_TABLES[kind].table} r WHERE ${scope.sql}
       )
     ) ranked ON ranked.id = r.id
     ${
       cursor
         ? `WHERE ranked.score < ?
       OR (ranked.score = ? AND ranked.diversity_rank > ?)
       OR (ranked.score = ? AND ranked.diversity_rank = ? AND ranked.sort_time < ?)
       OR (ranked.score = ? AND ranked.diversity_rank = ? AND ranked.sort_time = ? AND r.id > ?)`
         : ''
     }
     ORDER BY ranked.score DESC, ranked.diversity_rank ASC, ranked.sort_time DESC, r.id ASC LIMIT ?`,
    parameters,
  );
  // Native SQL cannot be interrupted by this port; never publish a cancelled read.
  checkHealthEvidenceAbort(options.signal);
  const pageRows = result.rows.slice(0, limit);
  const records: LocalHealthEvidenceRecord[] = [];
  const unsafeKinds = new Set<RecordKind>();
  appendHealthEvidenceRows(kind, pageRows, limit, records, unsafeKinds);
  const last = pageRows[pageRows.length - 1];
  if (
    last &&
    (typeof last.id !== 'string' ||
      typeof last.sort_time !== 'string' ||
      typeof last.score !== 'number' ||
      typeof last.diversity_rank !== 'number')
  ) {
    throw new Error('Invalid ranked evidence result cursor.');
  }
  return {
    records,
    incomplete: unsafeKinds.size > 0,
    nextCursor:
      result.rows.length > limit && last
        ? {
            id: last.id as string,
            score: last.score as number,
            timeKey: last.sort_time as string,
            diversityRank: last.diversity_rank as number,
          }
        : null,
  };
}
