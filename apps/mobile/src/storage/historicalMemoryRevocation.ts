import type { SqlExecutor } from '@orot/storage';
import { researchArtifactRowId } from './researchArtifactCodec';
import { suppressExplicitlyRemovedHistory } from './conversationHistoryDisplayAncestorFence';

/** Historical display is independent of today's evidence policy, never of a
 * durable privacy decision. Absence is not a revocation; known negatives win. */
export async function hasHistoricalMemoryRevocation(
  tx: SqlExecutor,
  id: string,
  sources: readonly string[],
) {
  const { rows } = await tx.execute(
    "SELECT name FROM sqlite_master WHERE type='table'",
  );
  const tables = new Set(rows.map(row => row.name));
  const identities = [id, ...sources];
  for (const marker of [
    'source_deletion_tombstones',
    'agent_memory_removed_sources',
  ]) {
    if (
      tables.has(marker) &&
      (await found(
        tx,
        `SELECT 1 FROM json_each(?) i JOIN ${marker} removed ON removed.source_id=i.value LIMIT 1`,
        [JSON.stringify(identities)],
      ))
    )
      return true;
  }
  // Restored backups might retain the negative staleness receipt even if a
  // newer eager cleanup trigger was not installed at deletion time.
  if (
    tables.has('transcript_artifact_staleness') &&
    (await found(
      tx,
      "SELECT 1 FROM json_each(?) i JOIN transcript_artifact_staleness removed ON removed.artifact_id=i.value WHERE removed.artifact_kind='visit_question' LIMIT 1",
      [JSON.stringify(sources)],
    ))
  )
    return true;
  for (const source of sources) {
    if (!source.startsWith('generated-artifact:')) continue;
    const match =
      /^generated-artifact:(generated_research|generated_summary|generated_conversation):(.+)$/u.exec(
        source,
      );
    if (!match) return true;
    const [, kind, identity] = match;
    if (!identity || identity.trim() !== identity) return true;
    if (kind === 'generated_research') {
      const rowId = researchArtifactRowId(identity);
      if (rowId === null || (await researchRevoked(tx, tables, rowId)))
        return true;
    } else if (kind === 'generated_summary') {
      if (
        tables.has('conversation_invalid_summaries') &&
        (await found(
          tx,
          'SELECT 1 FROM conversation_invalid_summaries WHERE id=?',
          [identity],
        ))
      )
        return true;
    } else if (await conversationRevoked(tx, tables, identity)) {
      return true;
    }
  }
  return false;
}

async function researchRevoked(
  tx: SqlExecutor,
  tables: ReadonlySet<unknown>,
  id: number,
) {
  if (
    tables.has('research_artifact_invalid') &&
    (await found(tx, 'SELECT 1 FROM research_artifact_invalid WHERE id=?', [
      id,
    ]))
  )
    return true;
  if (!tables.has('research_artifacts')) return false;
  const row = (
    await tx.execute(
      `SELECT
      CASE WHEN json_valid(snapshot_json) THEN json_type(snapshot_json, '$.originSession') ELSE 'invalid' END AS type,
      CASE WHEN json_valid(snapshot_json) THEN json_extract(snapshot_json, '$.originSession') END AS owner
     FROM research_artifacts WHERE id=?`,
      [id],
    )
  ).rows[0];
  if (!row || row.type === null || row.type === 'null') return false;
  return (
    row.type !== 'text' ||
    typeof row.owner !== 'string' ||
    !row.owner ||
    !canReadSessionMetadata(tables) ||
    !(await found(
      tx,
      `SELECT 1 WHERE ${visibleConversationOwner(tables, '?')}`,
      [row.owner],
    ))
  );
}

function canReadSessionMetadata(tables: ReadonlySet<unknown>) {
  return (
    tables.has('conversation_artifact_sessions') &&
    tables.has('conversation_artifact_generation')
  );
}

function visibleConversationOwner(
  tables: ReadonlySet<unknown>,
  session: string,
) {
  const removed = tables.has('conversation_artifact_removed_sessions')
    ? ' AND NOT EXISTS (SELECT 1 FROM conversation_artifact_removed_sessions d WHERE d.id=s.id)'
    : '';
  return `EXISTS (SELECT 1 FROM conversation_artifact_sessions s JOIN conversation_artifact_generation g ON g.generation=s.generation
    WHERE s.id=${session} AND s.hidden=0 AND g.singleton=1${removed})`;
}

async function conversationRevoked(
  tx: SqlExecutor,
  tables: ReadonlySet<unknown>,
  id: string,
) {
  for (const table of [
    'conversation_deleted_artifacts',
    'conversation_invalid_parents',
  ]) {
    if (
      tables.has(table) &&
      (await found(tx, `SELECT 1 FROM ${table} WHERE id=?`, [id]))
    )
      return true;
  }
  for (const [table, key] of [
    ['conversation_artifacts', 'id'],
    ['conversation_tool_events', 'message_id'],
  ]) {
    if (!tables.has(table)) continue;
    // A known but inaccessible session is not equivalent to a legacy absence.
    if (!canReadSessionMetadata(tables)) return true;
    if (
      await found(
        tx,
        `SELECT 1 FROM ${table} a WHERE a.${key}=? AND NOT (${visibleConversationOwner(tables, 'a.session_id')}) LIMIT 1`,
        [id],
      )
    )
      return true;
  }
  if (
    tables.has('conversation_tool_events') &&
    tables.has('conversation_tool_removed_calls') &&
    (await found(
      tx,
      'SELECT 1 FROM conversation_tool_events a JOIN conversation_tool_removed_calls r USING(session_id,run_id,call_id) WHERE a.message_id=? LIMIT 1',
      [id],
    ))
  )
    return true;
  if (!tables.has('conversation_artifact_sources')) return false;
  // Reuse the historical reader’s exact transitive Hide/delete rules, never
  // today's source verification. Incomplete revocation metadata fails closed.
  if (
    [
      'conversation_invalid_summaries',
      'conversation_invalid_parents',
      'conversation_deleted_artifacts',
      'conversation_artifacts',
      'conversation_artifact_sessions',
      'conversation_artifact_removed_sessions',
      'source_deletion_tombstones',
      'agent_memory_removed_sources',
      'typed_deletion_markers',
    ].some(table => !tables.has(table))
  )
    return true;
  return (await suppressExplicitlyRemovedHistory(tx, [id])).length !== 0;
}

async function found(tx: SqlExecutor, sql: string, binds: (number | string)[]) {
  return (await tx.execute(sql, binds)).rows.length !== 0;
}
