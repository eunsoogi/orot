import { memoryParentAvailable } from './agentMemoryParentQuarantine';
import { decodeAgentMemoryRecord } from './agentMemoryStorageRecords';
import type { SqlExecutor } from '@orot/storage';
import type { PersistedMemoryRecord } from '@orot/agent-memory';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import { VisitQuestionSchema } from '@orot/domain';
import { healthPeriodDependencyId } from './healthPeriodDependencies';

export function reviewedMemoryRevision(record: PersistedMemoryRecord) {
  return fingerprint({
    id: record.id,
    text: record.text,
    meta: record.meta,
    createdAt: record.createdAt,
  });
}
export function memoryPeriodIds(record: PersistedMemoryRecord): string[] {
  const ids = (record.meta.provenance as { sourceIds?: unknown } | undefined)
    ?.sourceIds;
  return Array.isArray(ids)
    ? ids.filter(
        (id): id is string =>
          typeof id === 'string' && id.startsWith('health-period-version-'),
      )
    : [];
}
/** Only a new or already-attested reviewed identity may attest exact persisted current questions.
 * A shared period hash or a later current parent must never upgrade existing legacy text. */
export async function attestNewMemoryPeriods(
  tx: SqlExecutor,
  record: PersistedMemoryRecord,
) {
  const periods = memoryPeriodIds(record);
  if (!periods.length) return;
  const existing = await tx.execute(
    'SELECT id,record_json FROM agent_memory_records WHERE id=?',
    [record.id],
  );
  if (existing.rows.length) {
    const tables = await tx.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('memory_period_attestation','memory_parent_quarantine')",
    );
    const present = new Set(tables.rows.map(row => row.name));
    if (!present.has('memory_period_attestation')) return;
    const prior = decodeAgentMemoryRecord(existing.rows[0]?.record_json);
    if (
      present.has('memory_parent_quarantine') &&
      (
        await tx.execute(
          'SELECT memory_id FROM memory_parent_quarantine WHERE memory_id=?',
          [prior.id],
        )
      ).rows.length
    )
      return;
    // A normal same-identity re-review must still have its complete prior lineage
    // available, including generated and tool parents, not merely a period attestation.
    if (
      !(await memoryParentAvailable(tx, prior)) ||
      !(await memoryPeriodsAttested(tx, prior))
    )
      return;
  }
  const refs =
    (
      record.meta.provenance as {
        sourceReferences?: readonly { kind: string; id: string }[];
      }
    ).sourceReferences ?? [];
  const covered = new Set<string>();
  const parents: { id: string; revision: string }[] = [];
  const tables = await tx.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('visit_questions','visit_period_policy')",
  );
  if (tables.rows.length !== 2) return;
  for (const ref of refs) {
    if (ref.kind !== 'visit_question') continue;
    const row = (
      await tx.execute('SELECT payload_json FROM visit_questions WHERE id=?', [
        ref.id,
      ])
    ).rows[0];
    if (typeof row?.payload_json !== 'string') continue;
    const parsed = VisitQuestionSchema.safeParse(JSON.parse(row.payload_json));
    if (!parsed.success) continue;
    const current = await tx.execute(
      "SELECT status FROM visit_period_policy WHERE question_id=? AND revision=? AND status='current'",
      [ref.id, fingerprint(parsed.data)],
    );
    if (!current.rows.length) continue;
    parents.push({ id: ref.id, revision: fingerprint(parsed.data) });
    for (const source of parsed.data.healthContextSources ?? [])
      covered.add(healthPeriodDependencyId(source));
  }
  if (!periods.every(id => covered.has(id))) return;
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS memory_period_attestation(memory_id TEXT NOT NULL,revision TEXT NOT NULL,parents_json TEXT NOT NULL,PRIMARY KEY(memory_id,revision))',
  );
  await tx.execute(
    'CREATE TRIGGER IF NOT EXISTS memory_period_attestation_removed AFTER DELETE ON agent_memory_records BEGIN DELETE FROM memory_period_attestation WHERE memory_id=OLD.id; END',
  );
  await tx.execute(
    'INSERT OR IGNORE INTO memory_period_attestation VALUES (?,?,?)',
    [record.id, reviewedMemoryRevision(record), JSON.stringify(parents)],
  );
}

/** Recheck exact attested parent revisions on every read; a later question with the
 * same period or ID cannot lend its current policy to older reviewed memory. */
export async function memoryPeriodsAttested(
  tx: SqlExecutor,
  record: PersistedMemoryRecord,
) {
  const row = (
    await tx.execute(
      'SELECT parents_json FROM memory_period_attestation WHERE memory_id=? AND revision=?',
      [record.id, reviewedMemoryRevision(record)],
    )
  ).rows[0];
  if (typeof row?.parents_json !== 'string') return false;
  const parents: unknown = JSON.parse(row.parents_json);
  if (!Array.isArray(parents) || !parents.length) return false;
  for (const parent of parents) {
    if (
      !parent ||
      typeof parent.id !== 'string' ||
      typeof parent.revision !== 'string'
    )
      return false;
    const stored = (
      await tx.execute('SELECT payload_json FROM visit_questions WHERE id=?', [
        parent.id,
      ])
    ).rows[0];
    if (
      typeof stored?.payload_json !== 'string' ||
      fingerprint(JSON.parse(stored.payload_json)) !== parent.revision
    )
      return false;
    const policy = await tx.execute(
      "SELECT status FROM visit_period_policy WHERE question_id=? AND revision=? AND status='current'",
      [parent.id, parent.revision],
    );
    if (!policy.rows.length) return false;
  }
  return true;
}
