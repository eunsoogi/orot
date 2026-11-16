import type { AgentMemoryService } from '@orot/agent-memory';
import type { SqlDatabase } from '@orot/storage';
import { readManualHistoryEntry } from '@orot/storage';
import { decodeConversationArtifact } from '../storage/conversationArtifactCodec';
import { ensureStatementMemoryJobs } from '../storage/userStatementMemoryJobs';
import {
  conversationStatementMemory,
  manualHistoryMemory,
} from './userStatementMemory';

/** Drain a bounded batch locally. Failure leaves the identity queued; deleting or
 * correcting its authoritative source makes the subsequent write fail closed. */
export async function processStatementMemoryJobs(
  database: SqlDatabase,
  memory: Pick<AgentMemoryService, 'remember'>,
  active: () => boolean = () => true,
) {
  await ensureStatementMemoryJobs(database);
  const jobs = await database.execute(
    'SELECT source_kind, source_id FROM user_statement_memory_jobs ORDER BY rowid LIMIT 10',
  );
  let failed = 0;
  for (const row of jobs.rows) {
    try {
      if (!active()) return { failed };
      const id = String(row.source_id);
      let candidate;
      if (row.source_kind === 'manual_history') {
        const source = await readManualHistoryEntry(database, id);
        const newer = await database.execute(
          'SELECT id FROM manual_history_entries WHERE supersedes_id = ? LIMIT 1',
          [id],
        );
        if (source && !newer.rows.length)
          candidate = manualHistoryMemory(source);
      } else if (row.source_kind === 'conversation_user_statement') {
        const result = await database.execute(
          'SELECT a.result_json FROM conversation_artifacts a JOIN conversation_artifact_sessions s ON s.id = a.session_id WHERE a.id = ? AND s.hidden = 0',
          [id],
        );
        const source = decodeConversationArtifact(result.rows[0]?.result_json);
        if (source) candidate = conversationStatementMemory(source);
      }
      if (!active()) return { failed };
      // Do not truncate a long original into a misleading partial health statement.
      if (candidate && candidate.text.length > 4000) candidate = undefined;
      if (candidate) {
        // Exact repeated authored wording keeps its existing live source; no semantic merging
        // of negation or changed facts. Never rewrite memory supporting this same answer.
        if (row.source_kind === 'conversation_user_statement') {
          const prior = await database.execute(
            "SELECT record_json FROM agent_memory_records WHERE json_extract(record_json, '$.meta.provenance.reviewState') = 'user_stated' ORDER BY id LIMIT 500",
          );
          const wording = candidate.text.slice(
            candidate.text.indexOf('\n') + 1,
          );
          for (const saved of prior.rows) {
            if (typeof saved.record_json !== 'string') continue;
            const value = JSON.parse(saved.record_json);
            if (
              typeof value.text === 'string' &&
              value.text.slice(value.text.indexOf('\n') + 1) === wording &&
              value.meta?.kind === candidate.kind &&
              typeof value.meta.memoryKey === 'string' &&
              value.meta.provenance?.sourceReferences?.some(
                (ref: { kind?: string }) =>
                  ref.kind === 'conversation_user_statement',
              )
            ) {
              candidate = undefined;
              break;
            }
          }
        }
        if (!active()) return { failed };
        if (candidate) await memory.remember(candidate);
      }
      await database.execute(
        'DELETE FROM user_statement_memory_jobs WHERE source_kind = ? AND source_id = ?',
        [String(row.source_kind), id],
      );
    } catch {
      // Retain this job but do not starve unrelated sources behind one failed embed.
      failed += 1;
      // Rotate a failed identity behind untouched jobs; a missing model must not
      // permanently starve later sources. UPDATE cannot recreate a deleted job.
      await database
        .execute(
          'UPDATE user_statement_memory_jobs SET rowid = (SELECT coalesce(max(rowid), 0) + 1 FROM user_statement_memory_jobs) WHERE source_kind = ? AND source_id = ?',
          [String(row.source_kind), String(row.source_id)],
        )
        .catch(() => {});
    }
  }
  return { failed };
}

/** Migration is additive: enqueue current originals, retaining unknown dates and full lineage. */
export async function enqueueExistingHistoryMemories(database: SqlDatabase) {
  await ensureStatementMemoryJobs(database);
  await database.execute(
    "INSERT OR IGNORE INTO user_statement_memory_jobs (source_kind, source_id) SELECT 'manual_history', h.id FROM manual_history_entries h WHERE NOT EXISTS (SELECT 1 FROM manual_history_entries newer WHERE newer.supersedes_id = h.id) AND NOT EXISTS (SELECT 1 FROM agent_memory_records m WHERE json_extract(m.record_json, '$.meta.memoryKey') = 'manual-history-memory:' || h.id)",
  );
}
