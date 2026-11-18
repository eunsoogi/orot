import type { SqlExecutor } from '@orot/storage';
import type { VisitQuestionHealthContextSource } from '@orot/domain';
import { readHealthContextReport } from '../healthEvidence/healthContext/reader';
import { healthContextRevision } from '../healthEvidence/healthContext/scope';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';

export { healthPeriodDeletionGuards } from './healthPeriodContributorGuards';

/** A removed period version gets an opaque fence; later recomputations use a different version. */
export function healthPeriodDependencyId(
  source: VisitQuestionHealthContextSource,
): string {
  return `health-period-version-${fingerprint(source)}`;
}

/** The primary-key prefix lookup avoids loading every historical raw-source tombstone on each memory recall. */
export async function listInvalidatedHealthPeriods(
  tx: SqlExecutor,
): Promise<string[]> {
  const result = await tx.execute(
    "SELECT source_id FROM agent_memory_removed_sources WHERE source_id GLOB 'health-period-version-*'",
  );
  return result.rows.flatMap(row =>
    typeof row.source_id === 'string' ? [row.source_id] : [],
  );
}

/** Re-read inside the caller's write transaction so deletion cannot race a derived insert. */
export async function assertHealthPeriodCurrent(
  tx: SqlExecutor,
  source: VisitQuestionHealthContextSource,
) {
  const report = await readHealthContextReport(tx, source.scope.window, [
    source.scope.topic,
  ]);
  if (
    report.deletionGeneration !== source.deletionGeneration ||
    healthContextRevision(source.scope, report) !== source.revision
  )
    throw new Error('The cited health period changed before saving.');
}

/** Check the actual definition inside every caller-owned setup transaction.
 * Only exact stored SQL can avoid recompilation; missing or old backup guards
 * still upgrade. Never cache schema readiness or normalize trigger bodies. */
export async function replaceHealthPeriodTrigger(tx: SqlExecutor, sql: string) {
  const name =
    /^CREATE TRIGGER(?: IF NOT EXISTS)? ([a-zA-Z_][a-zA-Z0-9_]*)\s/u.exec(
      sql,
    )?.[1];
  if (!name) throw new Error('Invalid app health-period trigger definition.');
  // SQLite omits this optional header clause from sqlite_master.sql.
  // Preserve all body whitespace and string literals, including meaningful spaces.
  const expected = sql.replace(
    /^CREATE TRIGGER IF NOT EXISTS /u,
    'CREATE TRIGGER ',
  );
  const current = await tx.execute(
    "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
    [name],
  );
  if (current.rows.length === 1 && current.rows[0]?.sql === expected) return;
  await tx.execute(`DROP TRIGGER IF EXISTS ${name}`);
  await tx.execute(sql);
}
