import type { SqlDatabase } from '@orot/storage';
import type { GeneratedReportRow } from './types';

/** Discover typed saved outputs, not conversation wording. SQL returns metadata only.
 * Older summary stores remain metadata-visible without optional policy tables;
 * their unavailable flag never authorizes opening prose. Incomplete session fences opt out.
 * The (date,key) cursor is stable even when several outputs share one timestamp. */
export async function listGeneratedReports(
  database: SqlDatabase,
  before?: { createdAt: string; key: string },
): Promise<readonly GeneratedReportRow[]> {
  const tables = new Set(
    (
      await database.execute(
        "SELECT name FROM sqlite_master WHERE type='table'",
      )
    ).rows.map(r => r.name),
  );
  const queries: string[] = [];
  if (tables.has('symptom_summary_runs')) {
    const daily = tables.has('daily_report_revisions');
    const invalid = tables.has('conversation_invalid_summaries')
      ? 'EXISTS(SELECT 1 FROM conversation_invalid_summaries i WHERE i.id=r.id)'
      : '1';
    const quarantine = tables.has('summary_period_policy')
      ? "EXISTS(SELECT 1 FROM summary_period_policy p WHERE p.summary_id=r.id AND p.status='quarantined')"
      : '1';
    queries.push(`SELECT 'summary:'||r.id AS key,r.id,'summary' AS origin,
      CASE ${daily ? "WHEN d.run_id IS NOT NULL THEN 'daily_report'" : ''}
        WHEN json_extract(r.result_json,'$.analysis.presentation')='symptom_summary' THEN 'health_summary'
        ELSE 'possibilities' END AS kind,r.created_at AS createdAt,
      (${invalid}) OR (${quarantine}) AS unavailable
      FROM symptom_summary_runs r ${daily ? 'LEFT JOIN daily_report_revisions d ON d.run_id=r.id' : ''}
      WHERE json_valid(r.result_json) AND (
        ${daily ? 'd.run_id IS NOT NULL OR' : ''}
        (json_type(r.result_json,'$.analysis.hypotheses')='array'
         AND json_extract(r.result_json,'$.id')=r.id
         AND json_type(r.result_json,'$.sources')='array'
         AND json_type(r.result_json,'$.modelId')='text'
         AND json_type(r.result_json,'$.providerId')='text'
         AND (json_type(r.result_json,'$.analysis.presentation') IS NULL OR json_extract(r.result_json,'$.analysis.presentation')='symptom_summary')))`);
  }
  if (tables.has('visit_questions'))
    queries.push(`
    SELECT 'visit:'||json_extract(payload_json,'$.appointmentId') AS key,
      json_extract(payload_json,'$.appointmentId') AS id,'visit' AS origin,'visit_questions' AS kind,
      MAX(coalesce(recorded_at,effective_at,ingested_at)) AS createdAt,0 AS unavailable FROM visit_questions
    WHERE json_valid(payload_json) AND json_type(payload_json,'$.appointmentId')='text'
      AND length(json_extract(payload_json,'$.appointmentId'))>0 GROUP BY json_extract(payload_json,'$.appointmentId')`);
  if (
    [
      'conversation_artifacts',
      'conversation_artifact_sessions',
      'conversation_artifact_generation',
      'conversation_invalid_parents',
      'conversation_deleted_artifacts',
    ].every(table => tables.has(table))
  )
    queries.push(`
    SELECT 'conversation:'||a.id AS key,a.id,'conversation' AS origin,'possibilities' AS kind,
      a.created_at AS createdAt,EXISTS(SELECT 1 FROM conversation_invalid_parents i WHERE i.id=a.id) AS unavailable
    FROM conversation_artifacts a JOIN conversation_artifact_sessions s ON s.id=a.session_id AND s.hidden=0
    JOIN conversation_artifact_generation g ON g.singleton=1 AND s.generation=g.generation
    WHERE json_valid(a.result_json) AND json_extract(a.result_json,'$.status')='complete'
      AND json_extract(a.result_json,'$.entryIntent')='possibilities'
      AND json_type(a.result_json,'$.healthSummary') IS NULL
      AND json_type(a.result_json,'$.dailyReport') IS NULL
      AND json_type(a.result_json,'$.visitQuestions') IS NULL
      AND NOT EXISTS(SELECT 1 FROM conversation_deleted_artifacts d WHERE d.id=a.id)`);
  if (!queries.length) return [];
  const result = await database.execute(
    `SELECT * FROM (${queries.join(' UNION ALL ')})
    WHERE julianday(createdAt) IS NOT NULL AND createdAt GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'
      AND (? IS NULL OR createdAt<? OR (createdAt=? AND key<?))
    ORDER BY createdAt DESC,key DESC LIMIT 20`,
    [
      before?.createdAt ?? null,
      before?.createdAt ?? null,
      before?.createdAt ?? null,
      before?.key ?? null,
    ],
  );
  return result.rows
    .filter(
      r =>
        typeof r.createdAt === 'string' &&
        Number.isFinite(Date.parse(r.createdAt)),
    )
    .map(r => ({
      key: String(r.key),
      id: String(r.id),
      origin: r.origin as GeneratedReportRow['origin'],
      kind: r.kind as GeneratedReportRow['kind'],
      createdAt: String(r.createdAt),
      unavailable: r.unavailable === 1,
    }));
}
