import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';

/** Synthetic SQLite completion plus injected reader failure; no provider is called twice. */
test('refresh is bound to its private completed identity and fails closed on read errors', async () => {
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
    const read = jest.spyOn(retention, 'readCommittedCompletion');
    const sessions = createConversationSessions({ retention });
    const sender = jest.fn(async (question, _history, signal, observer) => {
      await observer!.onRetentionCandidate!(
        {
          question,
          answer: 'Original protected answer',
          providerId: 'p',
          modelId: 'm',
          sources: [],
          citations: [],
        },
        signal!,
      );
      return {
        status: 'answer' as const,
        answer: 'Original protected answer',
        citations: [],
      };
    });
    const handle = sessions.sendOwnedPrompt(1, 'Synthetic question', sender);
    const result = await handle.completion;
    if (result.status !== 'completed')
      throw new Error('Expected synthetic completion');
    const original = { ...result.identity };
    // Runtime callers cannot redirect this method by mutating the exposed result object.
    Object.assign(result.identity, {
      messageId: 'other-artifact',
      requestId: 'other-request',
    });
    expect(await handle.readCurrentCompletion()).toBe(
      'Original protected answer',
    );
    expect(read).toHaveBeenLastCalledWith(original);
    read.mockRejectedValueOnce(new Error('Synthetic unavailable database'));
    expect(await handle.readCurrentCompletion()).toBeNull();
    expect(await handle.readCurrentCompletion()).toBe(
      'Original protected answer',
    );
    expect(sender).toHaveBeenCalledTimes(1);
    sessions.dispose();
  } finally {
    connection.close();
  }
});

test('source deletion after completion revokes the same handle without replaying its request', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    let sequence = 0;
    const sessions = createConversationSessions({
      retention: createConversationSessionRetention({
        openStorage: async () => storage,
        createId: () => `refresh-${++sequence}`,
        now: () => '2026-11-13T00:00:00.000Z',
      }),
    });
    const sender = jest.fn(async (question, _history, signal, observer) => {
      await observer!.onRetentionCandidate!(
        {
          question,
          answer: 'Synthetic source-backed answer',
          providerId: 'p',
          modelId: 'm',
          sources: f.saved.sources,
          citations: [],
        },
        signal!,
      );
      return {
        status: 'answer' as const,
        answer: 'Synthetic source-backed answer',
        citations: [],
      };
    });
    const handle = sessions.sendOwnedPrompt(1, 'Synthetic request', sender);
    expect(await handle.completion).toMatchObject({ status: 'completed' });
    expect(await handle.readCurrentCompletion()).toBe(
      'Synthetic source-backed answer',
    );
    await f.repository.delete('health_observation', f.inside.id);
    expect(await handle.readCurrentCompletion()).toBeNull();
    expect(sender).toHaveBeenCalledTimes(1);
    sessions.dispose();
  } finally {
    f.close();
  }
});
