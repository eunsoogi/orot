import { directMemoryParentsAvailable } from './agentMemoryDirectParents';
import {
  reviewedMemoryRevision as revision,
  memoryPeriodIds,
  memoryPeriodsAttested,
} from './agentMemoryPeriodAttestation';
import type { SqlExecutor } from '@orot/storage';
import type { PersistedMemoryRecord } from '@orot/agent-memory';
import {
  referencesAnySource,
  decodeAgentMemoryRecord,
} from './agentMemoryStorageRecords';

/** Parent policy is separate from deletion: it must hide derived memory without
 * deleting reviewed text or pretending an unavailable parent was recreated. */
export async function memoryParentQuarantineSources(tx: SqlExecutor) {
  const tables = await tx.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('research_period_policy','summary_period_policy','visit_period_policy','memory_parent_quarantine','memory_period_attestation','agent_memory_records','tool_period_policy','conversation_tool_events','conversation_tool_lineage')",
  );
  const present = new Set(tables.rows.map(row => row.name));
  const ids = new Set<string>();
  for (const [table, column, kind, prefix] of [
    [
      'research_period_policy',
      'artifact_id',
      'generated_research',
      'research-',
    ],
    ['summary_period_policy', 'summary_id', 'generated_summary', ''],
  ] as const) {
    if (!present.has(table)) continue;
    const rows = await tx.execute(
      `SELECT ${column} AS id FROM ${table} WHERE status='quarantined'`,
    );
    for (const row of rows.rows)
      ids.add(`generated-artifact:${kind}:${prefix}${row.id}`);
  }
  if (
    present.has('conversation_tool_events') &&
    present.has('conversation_tool_lineage')
  ) {
    const join = present.has('tool_period_policy')
      ? 'LEFT JOIN tool_period_policy p USING(session_id,run_id,call_id)'
      : '';
    const status = present.has('tool_period_policy') ? 'p.status' : 'NULL';
    const rows = await tx.execute(
      `SELECT DISTINCT e.message_id FROM conversation_tool_events e ${join} LEFT JOIN conversation_tool_lineage l USING(session_id,run_id,call_id) WHERE ${status}='quarantined' OR (${status} IS NULL AND EXISTS (SELECT 1 FROM json_each(l.sources_json) source WHERE json_extract(source.value,'$.kind')='health_context_period' AND json_extract(source.value,'$.scope.topic') IN ('measurements','activity')))`,
    );
    for (const row of rows.rows)
      ids.add(`generated-artifact:generated_conversation:${row.message_id}`);
  }
  return { ids, present };
}

/** Decisions are bound to the exact memory, never a shared period trust key. */
export async function memoryParentAvailable(
  tx: SqlExecutor,
  record: PersistedMemoryRecord,
) {
  const { ids, present } = await memoryParentQuarantineSources(tx);
  if (present.has('memory_parent_quarantine')) {
    const old = await tx.execute(
      'SELECT memory_id FROM memory_parent_quarantine WHERE memory_id=?',
      [record.id],
    );
    if (old.rows.length) return false;
  }
  let opaque = memoryPeriodIds(record).length > 0;
  if (opaque && present.has('memory_period_attestation')) {
    opaque = !(await memoryPeriodsAttested(tx, record));
  }
  if (
    !opaque &&
    !referencesAnySource(record, ids) &&
    (await directMemoryParentsAvailable(tx, record))
  )
    return true;
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS memory_parent_quarantine(memory_id TEXT NOT NULL, revision TEXT NOT NULL, PRIMARY KEY(memory_id,revision))',
  );
  await tx.execute(
    'CREATE TRIGGER IF NOT EXISTS memory_parent_quarantine_removed AFTER DELETE ON agent_memory_records BEGIN DELETE FROM memory_parent_quarantine WHERE memory_id=OLD.id; END',
  );
  await tx.execute(
    'INSERT OR IGNORE INTO memory_parent_quarantine VALUES (?,?)',
    [record.id, revision(record)],
  );
  return false;
}

/** Include parent-policy changes in the existing live-engine refresh fence. */
export async function memoryParentQuarantineRevision(tx: SqlExecutor) {
  let { ids, present } = await memoryParentQuarantineSources(tx);
  if (present.has('agent_memory_records')) {
    await unavailableMemoryMetadata(tx);
    ({ ids, present } = await memoryParentQuarantineSources(tx));
  }
  const marked = present.has('memory_parent_quarantine')
    ? (
        await tx.execute(
          'SELECT memory_id,revision FROM memory_parent_quarantine ORDER BY memory_id,revision',
        )
      ).rows
    : [];
  return JSON.stringify([[...ids].sort(), marked]);
}

export async function unavailableMemoryMetadata(tx: SqlExecutor) {
  const rows = await tx.execute(
    'SELECT id, record_json FROM agent_memory_records ORDER BY id',
  );
  const result: {
    id: string;
    createdAt: number;
    reason: 'unverifiable_parent';
    recovery: 'review_again';
  }[] = [];
  for (const row of rows.rows) {
    const record = decodeAgentMemoryRecord(row.record_json);
    if (!(await memoryParentAvailable(tx, record)))
      result.push({
        id: record.id,
        createdAt: record.createdAt,
        reason: 'unverifiable_parent',
        recovery: 'review_again',
      });
  }
  return result;
}

/** Return retained originals for storage-only compaction merging, never for recall. */
export async function quarantinedMemoryRecords(tx: SqlExecutor) {
  const rows = await tx.execute(
    'SELECT id, record_json FROM agent_memory_records ORDER BY id',
  );
  const result: PersistedMemoryRecord[] = [];
  for (const row of rows.rows) {
    const record = decodeAgentMemoryRecord(row.record_json);
    if (!(await memoryParentAvailable(tx, record))) result.push(record);
  }
  return result;
}

/** An update cannot evade parent quarantine by stripping all old source IDs. */
export async function assertPriorMemoryAvailable(
  tx: SqlExecutor,
  record: PersistedMemoryRecord,
) {
  const row = (
    await tx.execute(
      'SELECT id, record_json FROM agent_memory_records WHERE id=?',
      [record.id],
    )
  ).rows[0];
  if (
    row &&
    !(await memoryParentAvailable(tx, decodeAgentMemoryRecord(row.record_json)))
  )
    throw new Error('The reviewed memory parent is unavailable.');
}
