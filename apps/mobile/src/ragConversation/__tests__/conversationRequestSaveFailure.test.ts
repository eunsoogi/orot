import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';

test('a failed answer write emits no completion and a save-only retry commits once', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.currentGeneration();
    await connection.database.execute(
      "CREATE TRIGGER fail_answer BEFORE INSERT ON conversation_artifacts BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    );
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => `identity-${++sequence}`,
      now: () => '2026-11-13T00:00:00.000Z',
    });
    const sessions = createConversationSessions({ retention });
    const sender = jest.fn(async (question, _history, signal, observer) => {
      try {
        await observer!.onRetentionCandidate!(
          {
            question,
            answer: 'Synthetic answer',
            providerId: 'provider',
            modelId: 'model',
            sources: [],
            citations: [],
          },
          signal!,
        );
      } catch {
        observer!.onRetentionFailure!();
      }
      return {
        status: 'answer' as const,
        answer: 'Synthetic answer',
        citations: [],
      };
    });
    sessions.setDraft(1, 'Synthetic question');
    await sessions.send(1, sender);
    expect(sessions.getSnapshot().sessions[0]?.unsavedCount).toBe(1);
    expect(await storage.listCompletionIdentities()).toEqual([]);
    await connection.database.execute('DROP TRIGGER fail_answer');
    await sessions.retrySave(1);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sessions.getSnapshot().sessions[0]?.unsavedCount).toBe(0);
    expect(await storage.listCompletionIdentities()).toHaveLength(1);
    sessions.dispose();
  } finally {
    connection.close();
  }
});

test('an answer with no retention candidate is visibly unsaved', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => `identity-${++sequence}`,
      now: () => '2026-11-13T00:00:00.000Z',
    });
    const sessions = createConversationSessions({ retention });
    sessions.setDraft(1, 'Synthetic question');
    await sessions.send(1, async () => ({
      status: 'answer',
      answer: 'Synthetic answer',
      citations: [],
    }));
    expect(sessions.getSnapshot().sessions[0]?.error).toContain(
      '저장하지 못했어요',
    );
    expect(await storage.listCompletionIdentities()).toEqual([]);
    sessions.dispose();
  } finally {
    connection.close();
  }
});
