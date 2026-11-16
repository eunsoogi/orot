import { setupUserStatementInsertGuards } from './userStatementInsertGuards';
import {
  conversationStatementMemory,
  manualHistoryMemory,
} from '../memory/userStatementMemory';
import { decodeConversationArtifact } from './conversationArtifactCodec';
import { ManualHistoryEntrySchema } from '@orot/domain';
import type { SqlExecutor } from '@orot/storage';
import type { PersistedMemoryRecord } from '@orot/agent-memory';

const matches = (kind: string, id: string) =>
  `EXISTS (SELECT 1 FROM json_each(record_json, '$.meta.provenance.sourceReferences') s WHERE json_extract(s.value, '$.kind') = '${kind}' AND json_extract(s.value, '$.id') = ${id})`;

/** Original records remain authoritative. Deletion/correction removes only their projections.
 * These triggers also fence a late embedding completion: the writer rechecks the source. */
export async function setupUserStatementMemoryGuards(sql: SqlExecutor) {
  // Feed the existing engine invalidation channel with removed memory IDs, not raw
  // source IDs, so unrelated record kinds sharing an ID are never fenced.
  await sql.execute(
    "CREATE TRIGGER IF NOT EXISTS user_statement_memory_removed AFTER DELETE ON agent_memory_records WHEN json_extract(OLD.record_json, '$.meta.provenance.reviewState') = 'user_stated' BEGIN INSERT OR IGNORE INTO agent_memory_removed_sources (source_id) VALUES (OLD.id); END",
  );
  const tables = new Set(
    (
      await sql.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    ).rows.map(row => row.name),
  );
  await setupUserStatementInsertGuards(sql, tables);
  if (tables.has('manual_history_entries')) {
    const remove = `DELETE FROM agent_memory_records WHERE ${matches('manual_history', 'OLD.id')};`;
    await sql.execute(
      `CREATE TRIGGER IF NOT EXISTS memory_history_source_removed AFTER DELETE ON manual_history_entries BEGIN ${remove} END`,
    );
    await sql.execute(
      `CREATE TRIGGER IF NOT EXISTS memory_history_source_changed AFTER UPDATE ON manual_history_entries WHEN OLD.payload_json IS NOT NEW.payload_json BEGIN ${remove} END`,
    );
    await sql.execute(
      `CREATE TRIGGER IF NOT EXISTS memory_history_source_superseded AFTER INSERT ON manual_history_entries WHEN NEW.supersedes_id IS NOT NULL BEGIN DELETE FROM agent_memory_records WHERE ${matches('manual_history', 'NEW.supersedes_id')}; END`,
    );
  }
  if (tables.has('conversation_artifacts')) {
    const remove = `DELETE FROM agent_memory_records WHERE ${matches('conversation_user_statement', 'OLD.id')};`;
    await sql.execute(
      `CREATE TRIGGER IF NOT EXISTS memory_conversation_source_removed AFTER DELETE ON conversation_artifacts BEGIN ${remove} END`,
    );
    await sql.execute(
      `CREATE TRIGGER IF NOT EXISTS memory_conversation_source_changed AFTER UPDATE ON conversation_artifacts WHEN OLD.result_json IS NOT NEW.result_json BEGIN ${remove} END`,
    );
    await sql.execute(
      `CREATE TRIGGER IF NOT EXISTS memory_conversation_source_hidden AFTER UPDATE OF hidden ON conversation_artifact_sessions WHEN NEW.hidden = 1 BEGIN DELETE FROM agent_memory_records WHERE EXISTS (SELECT 1 FROM conversation_artifacts a WHERE a.session_id = NEW.id AND ${matches('conversation_user_statement', 'a.id')}); END`,
    );
  }
}

export class UserStatementSourceUnavailableError extends Error {}

export async function assertUserStatementMemoryCurrent(
  sql: SqlExecutor,
  record: PersistedMemoryRecord,
) {
  const provenance = record.meta.provenance as
    | {
        reviewState?: string;
        sourceReferences?: { kind: string; id: string }[];
      }
    | undefined;
  if (provenance?.reviewState !== 'user_stated') return;
  const references = provenance.sourceReferences;
  if (!references?.length)
    throw new UserStatementSourceUnavailableError(
      'User statement memory requires an original source.',
    );
  for (const ref of references) {
    const result =
      ref.kind === 'manual_history'
        ? await sql.execute(
            'SELECT payload_json FROM manual_history_entries h WHERE h.id = ? AND NOT EXISTS (SELECT 1 FROM manual_history_entries n WHERE n.supersedes_id = h.id)',
            [ref.id],
          )
        : ref.kind === 'conversation_user_statement'
          ? await sql.execute(
              'SELECT a.result_json FROM conversation_artifacts a JOIN conversation_artifact_sessions s ON s.id = a.session_id JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = s.generation WHERE a.id = ? AND s.hidden = 0',
              [ref.id],
            )
          : { rows: [] };
    const row = result.rows[0];
    const source =
      ref.kind === 'manual_history'
        ? typeof row?.payload_json === 'string'
          ? ManualHistoryEntrySchema.safeParse(JSON.parse(row.payload_json))
          : undefined
        : undefined;
    const turn = decodeConversationArtifact(row?.result_json);
    const expected = source?.success
      ? manualHistoryMemory(source.data)
      : turn
        ? conversationStatementMemory(turn)
        : undefined;
    if (
      !expected ||
      expected.text !== record.text ||
      expected.kind !== record.meta.kind
    )
      throw new UserStatementSourceUnavailableError(
        'Original user statement was removed or corrected.',
      );
  }
}
