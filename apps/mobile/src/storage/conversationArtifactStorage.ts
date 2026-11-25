import { createConversationAnswerMemory } from './conversationAnswerMemoryStore';
import { createConversationArtifactAppend } from './conversationArtifactAppend';
import { readConversationGeneration as generation } from './conversationGeneration';
import { createConversationWarmLeaseReader } from './conversationWarmLease';
import { createSavedGeneratedReportReferences } from './savedGeneratedReportReferences';
import { registerConversationStrictReaders } from './conversationStrictReadOwner';
import { createPlainConversationContextReader } from './plainConversationContext';
import { createDirectPhotoReplyWriter } from './conversationDirectPhotoReplies';
import { conversationTimelinePages } from './conversationTimelinePages';
import { continuousConversationStorage } from './continuousConversationStorage';
import { conversationSteeringHistory } from './conversationSteeringHistory';
import { conversationWorkflowContinuationOpener } from './conversationWorkflowContinuationOpener';
import type { SqlDatabase } from '@orot/storage';
import { setupConversationArtifactSchema } from './conversationArtifactSchema';
import { createConversationArtifactReader } from './conversationArtifactRead';
import { createConversationCompletionReader } from './conversationCompletionReader';
import { createConversationProjectionReaders } from './conversationHistoryPresentation';
import { listConversationArtifactPage } from './conversationArtifactPages';
import { createConversationSessionVisibility } from './conversationSessionVisibility';
import { createConversationToolEventStorage } from './conversationToolEventStorage';
import { createFilteredToolPeriodStorage } from './conversationToolFilteredStorage';
import { createConversationPreviewStorage } from './conversationPreviewStorage';
import { createConversationRequestStorage } from './conversationRequestStorage';
import { createConversationTaskCardStorage } from './conversationTaskCards';
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
  const tools = createConversationToolEventStorage(database, ensure);
  const listTimeline = conversationTimelinePages(database, ensure);
  const storage = {
    ...createSavedGeneratedReportReferences(database, ensure),
    ...createConversationAnswerMemory(database, ensure),
    listTimeline,
    writeDirectPhotoReply: createDirectPhotoReplyWriter(database, ensure),
    ...createConversationProjectionReaders(database, ensure),
    readPlainContextPage: createPlainConversationContextReader(
      database,
      listTimeline,
    ),
    continuousSession: continuousConversationStorage(database, ensure),
    validateWarmLease: createConversationWarmLeaseReader(database, ensure),
    readSteeringHistory: conversationSteeringHistory(database, ensure),
    openWorkflowContinuation: conversationWorkflowContinuationOpener(database),
    ...createConversationPreviewStorage(database, ensure),
    ...createConversationRequestStorage(database, ensure),
    ...createConversationTaskCardStorage(database, ensure),
    ...tools,
    ...createFilteredToolPeriodStorage(database, ensure),
    ...createConversationSessionVisibility(database, ensure),
    ...createConversationArtifactReader(
      database,
      ensure,
      tools.readToolTurnsSnapshot,
    ),
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
    append: createConversationArtifactAppend(database, ensure),
    async list(
      sessionId: string,
      cursor?: { readonly createdAt: string; readonly id: string },
      limit = 50,
      kind: 'conversation' | 'treatment' = 'conversation',
      ids?: readonly string[],
    ) {
      await ensure();
      return listConversationArtifactPage(
        database,
        sessionId,
        cursor,
        limit,
        kind,
        ids,
      );
    },
  };
  registerConversationStrictReaders(storage);
  return storage;
}
