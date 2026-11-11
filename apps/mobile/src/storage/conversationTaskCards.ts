import {
  parseTask,
  type ConversationTaskCard,
} from './conversationTaskCardCodec';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { assertConversationNotCancelled } from './conversationArtifactCancellation';
import { treatmentArtifactPredicate } from './treatmentSessionIdentity';
import {
  decodeConversationArtifact,
  type ConversationArtifact,
} from './conversationArtifactCodec';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';

export type { ConversationTaskCard } from './conversationTaskCardCodec';

export async function setupConversationTaskCards(tx: SqlExecutor) {
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS conversation_task_cards (session_id TEXT NOT NULL, id TEXT NOT NULL, created_at TEXT NOT NULL, revision INTEGER NOT NULL, task_json TEXT NOT NULL, PRIMARY KEY (session_id, id))',
  );
  await tx.execute(
    'CREATE TRIGGER IF NOT EXISTS conversation_task_cards_session_removed AFTER DELETE ON conversation_artifact_sessions BEGIN DELETE FROM conversation_task_cards WHERE session_id = OLD.id; END',
  );
  await tx.execute(
    "CREATE TRIGGER IF NOT EXISTS conversation_task_cards_artifact_removed AFTER DELETE ON conversation_artifacts BEGIN DELETE FROM conversation_task_cards WHERE session_id = OLD.session_id AND json_valid(task_json) AND json_extract(task_json, '$.kind') = 'treatment' AND json_extract(task_json, '$.artifactId') = OLD.id; END",
  );
}

/** Treatment output and its card share one commit and one session deletion boundary. */
export async function appendTreatmentTaskCard(
  tx: SqlExecutor,
  artifact: ConversationArtifact,
) {
  const id = `treatment:${artifact.id}`;
  if (id.length > 200) throw new Error('Invalid treatment task identity.');
  await tx.execute(
    'INSERT INTO conversation_task_cards VALUES (?, ?, ?, 1, ?)',
    [
      artifact.sessionId,
      id,
      artifact.createdAt,
      JSON.stringify({
        kind: 'treatment',
        artifactId: artifact.id,
        artifactRevision: fingerprint(artifact),
      }),
    ],
  );
}

/** Session leases fence deletion/undo and the card revision fences concurrent updates. */
export function createConversationTaskCardStorage(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  async function requireSession(
    tx: SqlExecutor,
    sessionId: string,
    version: number,
  ) {
    const result = await tx.execute(
      'SELECT s.id FROM conversation_artifact_sessions s JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation WHERE s.id = ? AND s.hidden = 0 AND s.version = ?',
      [sessionId, version],
    );
    if (!result.rows.length)
      throw new Error('Conversation session is unavailable.');
  }
  return {
    async writeTaskCard(input: {
      sessionId: string;
      sessionVersion: number;
      id: string;
      createdAt: string;
      expectedRevision: number | null;
      task: ConversationTaskCard;
      signal?: AbortSignal;
    }) {
      if (
        !input.id ||
        input.id.length > 200 ||
        !input.sessionId ||
        !Number.isSafeInteger(input.sessionVersion) ||
        input.sessionVersion < 0 ||
        !Number.isFinite(Date.parse(input.createdAt)) ||
        new Date(input.createdAt).toISOString() !== input.createdAt ||
        (input.expectedRevision !== null &&
          (!Number.isSafeInteger(input.expectedRevision) ||
            input.expectedRevision < 1 ||
            input.expectedRevision >= Number.MAX_SAFE_INTEGER))
      )
        throw new Error('Invalid task identity.');
      const encoded = JSON.stringify(input.task);
      const task =
        encoded.length <= 4096 ? parseTask(JSON.parse(encoded)) : null;
      if (!task) throw new Error('Invalid task card.');
      assertConversationNotCancelled(input.signal);
      await ensure();
      let stored = {
        id: input.id,
        createdAt: input.createdAt,
        revision: (input.expectedRevision ?? 0) + 1,
        task,
      };
      await database.transaction(async tx => {
        assertConversationNotCancelled(input.signal);
        await requireSession(tx, input.sessionId, input.sessionVersion);
        if (task.kind === 'treatment') {
          // A card cannot adopt another conversation's artifact or unrelated output.
          const artifact = await tx.execute(
            `SELECT a.result_json FROM conversation_artifacts a WHERE a.id = ? AND a.session_id = ? AND ${treatmentArtifactPredicate}`,
            [task.artifactId, input.sessionId],
          );
          if (!artifact.rows.length)
            throw new Error('Treatment output is unavailable.');
          if (task.artifactRevision !== undefined) {
            const decoded = decodeConversationArtifact(
              artifact.rows[0]?.result_json,
            );
            if (
              !decoded ||
              decoded.id !== task.artifactId ||
              decoded.sessionId !== input.sessionId ||
              fingerprint(decoded) !== task.artifactRevision
            )
              throw new Error('Treatment output changed.');
          }
        }
        const found = await tx.execute(
          'SELECT revision, created_at, task_json FROM conversation_task_cards WHERE session_id = ? AND id = ?',
          [input.sessionId, input.id],
        );
        const existing = found.rows[0];
        // A retry after an uncertain commit may acknowledge the exact previous write.
        if (
          existing &&
          existing.revision === (input.expectedRevision ?? 0) + 1 &&
          existing.task_json === encoded &&
          typeof existing.created_at === 'string' &&
          (input.expectedRevision === null ||
            existing.created_at === input.createdAt)
        ) {
          stored = { ...stored, createdAt: existing.created_at };
          assertConversationNotCancelled(input.signal);
          return;
        }
        if (input.expectedRevision === null) {
          if (existing) throw new Error('Task card already exists.');
          await tx.execute(
            'INSERT INTO conversation_task_cards VALUES (?, ?, ?, 1, ?)',
            [input.sessionId, input.id, input.createdAt, encoded],
          );
        } else {
          if (
            !existing ||
            existing.revision !== input.expectedRevision ||
            existing.created_at !== input.createdAt ||
            typeof existing.task_json !== 'string' ||
            parseTask(JSON.parse(existing.task_json))?.kind !== task.kind
          )
            throw new Error('Task card changed.');
          await tx.execute(
            'UPDATE conversation_task_cards SET revision = ?, task_json = ? WHERE session_id = ? AND id = ?',
            [input.expectedRevision + 1, encoded, input.sessionId, input.id],
          );
        }
        assertConversationNotCancelled(input.signal);
      });
      return stored;
    },
    async readTaskCards(sessionId: string, version: number) {
      await ensure();
      let cards: {
        id: string;
        createdAt: string;
        revision: number;
        task: ConversationTaskCard;
      }[] = [];
      await database.transaction(async tx => {
        await requireSession(tx, sessionId, version);
        const result = await tx.execute(
          'SELECT id, created_at, revision, task_json FROM conversation_task_cards WHERE session_id = ? ORDER BY created_at, id',
          [sessionId],
        );
        cards = result.rows.map(row => {
          const task =
            typeof row.task_json === 'string' && row.task_json.length <= 4096
              ? parseTask(JSON.parse(row.task_json))
              : null;
          if (
            !task ||
            typeof row.id !== 'string' ||
            !row.id ||
            row.id.length > 200 ||
            typeof row.created_at !== 'string' ||
            !Number.isFinite(Date.parse(row.created_at)) ||
            new Date(row.created_at).toISOString() !== row.created_at ||
            typeof row.revision !== 'number' ||
            !Number.isSafeInteger(row.revision) ||
            row.revision < 1
          )
            throw new Error('Invalid retained task card.');
          return {
            id: row.id,
            createdAt: row.created_at,
            revision: row.revision,
            task,
          };
        });
      });
      return cards;
    },
  };
}
