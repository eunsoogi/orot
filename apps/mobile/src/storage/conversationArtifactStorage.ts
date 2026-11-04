import {
  createManualHistoryRepository,
  localQueryTimestampKey,
  type SqlDatabase,
  type SqlExecutor,
} from '@orot/storage';
import { isPeriodSummarySource } from '../diseaseHypotheses/savedSummaries';
import {
  decodeConversationArtifact,
  type ConversationArtifact,
} from './conversationArtifactCodec';
import { setupConversationArtifactSchema } from './conversationArtifactSchema';
import { assertRetainedEvidenceCurrent } from './retainedEvidenceFreshness';
import { assertPeriodNotRemoved } from './conversationPeriodRemoval';

async function generation(tx: SqlExecutor): Promise<number> {
  const result = await tx.execute(
    'SELECT generation FROM conversation_artifact_generation WHERE singleton = 1',
  );
  const value = result.rows[0]?.generation;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Conversation generation is unavailable.');
  return value;
}

/** Check logical removal in addition to the physical row and revision checks. */
async function assertNotRemoved(tx: SqlExecutor, value: ConversationArtifact) {
  for (const source of value.sources) {
    if (isPeriodSummarySource(source)) {
      await assertPeriodNotRemoved(tx, source);
      continue;
    }
    if (source.reference.sourceKind === 'external_medical') continue;
    const ids = [
      source.reference.sourceId,
      source.reference.evidenceId,
      ...source.records.map(record => record.id),
    ];
    for (const id of ids) {
      const removed = await tx.execute(
        'SELECT source_id FROM source_deletion_tombstones WHERE source_id = ? UNION ALL SELECT source_id FROM agent_memory_removed_sources WHERE source_id = ? LIMIT 1',
        [id, id],
      );
      if (removed.rows.length)
        throw new Error('A source was removed before saving.');
    }
  }
}

/** Session and source validation share each write transaction; no retry can reopen a removed session. */
export function createConversationArtifactStorage(database: SqlDatabase) {
  let ready: Promise<void> | undefined;
  const history = createManualHistoryRepository(database);
  const ensure = () =>
    (ready ??= database
      // Period validation can sort private health values; keep temporary storage in memory.
      .execute('PRAGMA temp_store = MEMORY')
      .then(() => database.transaction(setupConversationArtifactSchema))
      .catch(error => {
        ready = undefined;
        throw error;
      }));
  return {
    async currentGeneration() {
      await ensure();
      return generation(database);
    },
    async createSession(id: string, expectedGeneration: number) {
      if (!id || id.length > 200) throw new Error('Invalid session identity.');
      await ensure();
      await database.transaction(async tx => {
        if ((await generation(tx)) !== expectedGeneration)
          throw new Error('Conversation data was cleared.');
        const removed = await tx.execute(
          'SELECT id FROM conversation_artifact_removed_sessions WHERE id = ?',
          [id],
        );
        if (removed.rows.length)
          throw new Error('Conversation session was removed.');
        await tx.execute(
          'INSERT INTO conversation_artifact_sessions (id, generation) VALUES (?, ?)',
          [id, expectedGeneration],
        );
      });
    },
    async deleteSession(id: string) {
      await ensure();
      await database.transaction(async tx => {
        // A pending create must not resurrect a session deleted before its row existed.
        await tx.execute(
          'INSERT OR IGNORE INTO conversation_artifact_removed_sessions (id) VALUES (?)',
          [id],
        );
        await tx.execute(
          'DELETE FROM conversation_artifact_sessions WHERE id = ?',
          [id],
        );
      });
    },
    async append(value: ConversationArtifact) {
      await ensure();
      const serialized = JSON.stringify(value);
      const decoded = decodeConversationArtifact(serialized);
      if (!decoded) throw new Error('The conversation output cannot be saved.');
      await database.transaction(async tx => {
        const sessions = await tx.execute(
          'SELECT generation FROM conversation_artifact_sessions WHERE id = ?',
          [decoded.sessionId],
        );
        if (
          !sessions.rows.length ||
          sessions.rows[0]?.generation !== (await generation(tx))
        )
          throw new Error('Conversation session was removed.');
        await assertNotRemoved(tx, decoded);
        await assertRetainedEvidenceCurrent(tx, decoded.sources, history);
        const existing = await tx.execute(
          'SELECT result_json FROM conversation_artifacts WHERE id = ?',
          [decoded.id],
        );
        if (existing.rows.length) {
          if (existing.rows[0]?.result_json !== serialized)
            throw new Error('A different output already owns this identity.');
          return;
        }
        await tx.execute(
          'INSERT INTO conversation_artifacts (id, session_id, created_at, result_json) VALUES (?, ?, ?, ?)',
          [decoded.id, decoded.sessionId, decoded.createdAt, serialized],
        );
        for (const source of decoded.sources) {
          if (isPeriodSummarySource(source)) {
            await tx.execute(
              'INSERT OR IGNORE INTO conversation_artifact_periods (artifact_id, topic, from_key, to_key) VALUES (?, ?, ?, ?)',
              [
                decoded.id,
                source.scope.topic,
                localQueryTimestampKey(source.scope.window.fromInclusive),
                localQueryTimestampKey(source.scope.window.toExclusive),
              ],
            );
          } else {
            if (source.reference.sourceKind !== 'external_medical') {
              for (const id of [
                source.reference.sourceId,
                source.reference.evidenceId,
              ])
                await tx.execute(
                  'INSERT OR IGNORE INTO conversation_artifact_sources (artifact_id, record_kind, record_id) VALUES (?, ?, ?)',
                  [decoded.id, 'identity', id],
                );
            }
            for (const record of source.records)
              await tx.execute(
                'INSERT OR IGNORE INTO conversation_artifact_sources (artifact_id, record_kind, record_id) VALUES (?, ?, ?)',
                [decoded.id, record.kind, record.id],
              );
          }
        }
      });
    },
    async read(id: string): Promise<ConversationArtifact | null> {
      await ensure();
      let output: ConversationArtifact | null = null;
      await database.transaction(async tx => {
        const row = await tx.execute(
          'SELECT id, session_id, created_at, result_json FROM conversation_artifacts WHERE id = ?',
          [id],
        );
        const value = decodeConversationArtifact(row.rows[0]?.result_json);
        if (
          !value ||
          value.id !== row.rows[0]?.id ||
          value.sessionId !== row.rows[0]?.session_id ||
          value.createdAt !== row.rows[0]?.created_at
        )
          return;
        try {
          await assertNotRemoved(tx, value);
          // Reads compare the actual period revision; unrelated deletions need not hide saved output.
          await assertRetainedEvidenceCurrent(
            tx,
            value.sources,
            history,
            false,
          );
          output = value;
        } catch {
          /* Changed sources make the result unavailable. */
        }
      });
      return output;
    },
    async list(
      sessionId: string,
      cursor?: { readonly createdAt: string; readonly id: string },
      limit = 50,
    ) {
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 50 ||
        (cursor &&
          (!cursor.id ||
            !Number.isFinite(Date.parse(cursor.createdAt)) ||
            new Date(cursor.createdAt).toISOString() !== cursor.createdAt))
      )
        throw new RangeError('Invalid conversation page.');
      await ensure();
      const result = await database.execute(
        'SELECT id, created_at FROM conversation_artifacts WHERE session_id = ? AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?',
        [
          sessionId,
          cursor?.createdAt ?? null,
          cursor?.createdAt ?? null,
          cursor?.createdAt ?? null,
          cursor?.id ?? null,
          limit + 1,
        ],
      );
      const rows = result.rows.slice(0, limit);
      const items = rows.map(row => {
        if (typeof row.id !== 'string' || typeof row.created_at !== 'string')
          throw new Error('Invalid conversation metadata.');
        return { id: row.id, createdAt: row.created_at };
      });
      return {
        items,
        nextCursor: result.rows.length > limit ? (items.at(-1) ?? null) : null,
      };
    },
  };
}
