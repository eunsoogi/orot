import type { SqlDatabase } from '@orot/storage';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

test('commit wins when cancellation follows the final transactional check', async () => {
  const f = await healthContextFixture();
  try {
    const controller = new AbortController();
    let abortBeforeCommit = false;
    const database: SqlDatabase = {
      execute: (...args) => f.database.execute(...args),
      transaction: operation =>
        f.database.transaction(async tx => {
          await operation(tx);
          if (abortBeforeCommit) {
            abortBeforeCommit = false;
            controller.abort();
          }
        }),
    };
    const storage = createConversationArtifactStorage(database);
    await storage.createSession('session', await storage.currentGeneration());
    const value = {
      id: 'turn',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      question: 'question',
      answer: 'answer',
      sources: f.saved.sources,
    };
    abortBeforeCommit = true;
    await expect(
      storage.append(value, controller.signal),
    ).resolves.toBeUndefined();
    expect(controller.signal.aborted).toBe(true);
    expect(await storage.read('turn')).toEqual(value);
  } finally {
    f.close();
  }
});

test('cancellation before the final transactional check rolls back the output', async () => {
  const f = await healthContextFixture();
  try {
    const controller = new AbortController();
    let abortOnInsert = false;
    const database: SqlDatabase = {
      execute: (...args) => f.database.execute(...args),
      transaction: operation =>
        f.database.transaction(async tx =>
          operation({
            ...tx,
            execute: async (query, args) => {
              const result = await tx.execute(query, args);
              if (
                abortOnInsert &&
                query.startsWith(
                  'INSERT OR IGNORE INTO conversation_artifact_periods',
                )
              ) {
                abortOnInsert = false;
                controller.abort();
              }
              return result;
            },
          }),
        ),
    };
    const storage = createConversationArtifactStorage(database);
    await storage.createSession('session', await storage.currentGeneration());
    const value = {
      id: 'turn',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      question: 'question',
      answer: 'answer',
      sources: f.saved.sources,
    };
    abortOnInsert = true;
    await expect(storage.append(value, controller.signal)).rejects.toThrow();
    expect(await storage.read('turn')).toBeNull();
  } finally {
    f.close();
  }
});

test('cancelling an idempotent retry cannot erase an output saved by an earlier request', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('session', await storage.currentGeneration());
    const value = {
      id: 'turn',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      question: 'question',
      answer: 'answer',
      sources: f.saved.sources,
    };
    await storage.append(value);
    const controller = new AbortController();
    controller.abort();
    await expect(storage.append(value, controller.signal)).rejects.toThrow();
    expect(await storage.read('turn')).toEqual(value);
    await storage.append(value);
  } finally {
    f.close();
  }
});
