import { createConversationWorkflowContinuationStore } from './conversationWorkflowContinuationStore';
import {
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
import { assertConversationArtifactCurrent } from './conversationArtifactFreshness';
import { createConversationArtifactReader } from './conversationArtifactRead';
import { createConversationCompletionReader } from './conversationCompletionReader';
import { listConversationArtifactPage } from './conversationArtifactPages';
import { createConversationSessionVisibility } from './conversationSessionVisibility';
import { assertConversationNotCancelled } from './conversationArtifactCancellation';
import {
  isGeneratedSummarySource,
  isGeneratedConversationSource,
  isGeneratedResearchSource,
  isConversationPhotoSource,
} from '../ragConversation/conversationArtifactSources';
import { createSymptomSummaryStorage } from './symptomSummaryStorage';
import { createConversationToolEventStorage } from './conversationToolEventStorage';
import { createFilteredToolPeriodStorage } from './conversationToolFilteredStorage';
import { createConversationPreviewStorage } from './conversationPreviewStorage';
import {
  commitConversationRequest,
  createConversationRequestStorage,
} from './conversationRequestStorage';
import {
  appendTreatmentTaskCard,
  createConversationTaskCardStorage,
} from './conversationTaskCards';

async function generation(tx: SqlExecutor): Promise<number> {
  const result = await tx.execute(
    'SELECT generation FROM conversation_artifact_generation WHERE singleton = 1',
  );
  const value = result.rows[0]?.generation;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Conversation generation is unavailable.');
  return value;
}

/** Session and source validation share each write transaction; no retry can reopen a removed session. */
export function createConversationArtifactStorage(database: SqlDatabase) {
  let ready: Promise<void> | undefined;
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
    async openWorkflowContinuation(
      identity: import('./conversationWorkflowContinuationIdentity').ConversationContinuationIdentity,
    ) {
      return createConversationWorkflowContinuationStore(database, identity);
    },
    ...createConversationPreviewStorage(database, ensure),
    ...createConversationRequestStorage(database, ensure),
    ...createConversationTaskCardStorage(database, ensure),
    ...createConversationToolEventStorage(database, ensure),
    ...createFilteredToolPeriodStorage(database, ensure),
    ...createConversationSessionVisibility(database, ensure),
    ...createConversationArtifactReader(database, ensure),
    readCommittedCompletion: createConversationCompletionReader(
      database,
      ensure,
    ),
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
        // A retry after an uncertain commit may reuse only the original active lease.
        const existing = await tx.execute(
          'SELECT generation, hidden, version FROM conversation_artifact_sessions WHERE id = ?',
          [id],
        );
        if (existing.rows.length) {
          const row = existing.rows[0]!;
          if (
            row.generation !== expectedGeneration ||
            row.hidden !== 0 ||
            row.version !== 0
          )
            throw new Error('Conversation session was removed.');
          return;
        }
        await tx.execute(
          'INSERT INTO conversation_artifact_sessions (id, generation) VALUES (?, ?)',
          [id, expectedGeneration],
        );
      });
      return 0;
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
    async append(
      value: ConversationArtifact,
      signal?: AbortSignal,
      expectedSessionVersion = 0,
    ) {
      await ensure();
      const serialized = JSON.stringify(value);
      const decoded = decodeConversationArtifact(serialized);
      if (!decoded) throw new Error('The conversation output cannot be saved.');
      // Install parent lifecycle guards even when this catalog opens before summary history.
      if (decoded.sources.some(isGeneratedSummarySource))
        await createSymptomSummaryStorage(database).list();
      assertConversationNotCancelled(signal);
      await database.transaction(async tx => {
        assertConversationNotCancelled(signal);
        const deletedArtifact = await tx.execute(
          'SELECT id FROM conversation_deleted_artifacts WHERE id = ? LIMIT 1',
          [decoded.id],
        );
        if (deletedArtifact.rows.length)
          throw new Error('The conversation output was removed.');
        const sessions = await tx.execute(
          'SELECT generation, version FROM conversation_artifact_sessions WHERE id = ? AND hidden = 0',
          [decoded.sessionId],
        );
        if (
          !sessions.rows.length ||
          sessions.rows[0]?.generation !== (await generation(tx)) ||
          sessions.rows[0]?.version !== expectedSessionVersion
        )
          throw new Error('Conversation session was removed.');
        await assertConversationArtifactCurrent(tx, database, decoded, true);
        assertConversationNotCancelled(signal);
        const existing = await tx.execute(
          'SELECT result_json FROM conversation_artifacts WHERE id = ?',
          [decoded.id],
        );
        if (existing.rows.length) {
          if (existing.rows[0]?.result_json !== serialized)
            throw new Error('A different output already owns this identity.');
          assertConversationNotCancelled(signal);
          await commitConversationRequest(
            tx,
            decoded,
            expectedSessionVersion,
            true,
          );
          return;
        }
        await tx.execute(
          'INSERT INTO conversation_artifacts (id, session_id, created_at, result_json) VALUES (?, ?, ?, ?)',
          [decoded.id, decoded.sessionId, decoded.createdAt, serialized],
        );
        if (decoded.treatmentContext)
          await appendTreatmentTaskCard(tx, decoded);
        for (const source of decoded.sources) {
          if (isConversationPhotoSource(source)) {
            // The request-source table owns the photo; no medical-record row is fabricated.
            continue;
          } else if (
            isGeneratedSummarySource(source) ||
            isGeneratedConversationSource(source) ||
            isGeneratedResearchSource(source)
          ) {
            await tx.execute(
              'INSERT OR IGNORE INTO conversation_artifact_sources (artifact_id, record_kind, record_id) VALUES (?, ?, ?)',
              [decoded.id, source.kind, source.id],
            );
          } else if (isPeriodSummarySource(source)) {
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
        // After this check, commit wins; the caller must report the saved result even if cancellation arrives later.
        assertConversationNotCancelled(signal);
        await commitConversationRequest(tx, decoded, expectedSessionVersion);
      });
    },
    async list(
      sessionId: string,
      cursor?: { readonly createdAt: string; readonly id: string },
      limit = 50,
      kind: 'conversation' | 'treatment' = 'conversation',
    ) {
      await ensure();
      return listConversationArtifactPage(
        database,
        sessionId,
        cursor,
        limit,
        kind,
      );
    },
  };
}
