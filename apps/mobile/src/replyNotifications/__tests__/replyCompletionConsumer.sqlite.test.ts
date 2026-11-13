import { AppState, NativeModules } from 'react-native';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createReplyNotificationLedger } from '../replyNotificationLedger';
import { createReplyCompletionConsumer } from '../replyCompletionConsumer';

test('only a saved current completion is submitted once', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const originalState = AppState.currentState;
  const originalModule = NativeModules.ReplyNotificationModule;
  const submit = jest.fn().mockResolvedValue('submitted');
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'background',
  });
  NativeModules.ReplyNotificationModule = {
    read: async () => ({ enabled: true, preview: true }),
    authorized: async () => true,
    lease: async () => ({ global: 0, session: 0 }),
    submit,
  };
  try {
    await runMigrations(connection.database);
    const store = createConversationArtifactStorage(connection.database);
    await store.createSession('session', await store.currentGeneration());
    const request = {
      id: 'request',
      sessionId: 'session',
      sessionVersion: 0,
      question: '합성 질문',
      createdAt: '2026-11-13T00:00:00.000Z',
    };
    await store.startRequest(request);
    const consume = createReplyCompletionConsumer(
      store,
      createReplyNotificationLedger(connection.database),
    );
    await consume(request.id);
    expect(submit).not.toHaveBeenCalled();
    await store.append({
      ...request,
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      answer: '**합성 답변**',
      sources: [],
    });
    await consume(request.id);
    await consume(request.id);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({
      requestId: 'request',
      sessionId: 'session',
      messageId: 'request',
      sessionVersion: 0,
      preview: '합성 답변',
      lease: { global: 0, session: 0 },
    });
    await store.deleteSession('session');
    await consume(request.id);
    expect(submit).toHaveBeenCalledTimes(1);
  } finally {
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: originalState,
    });
    NativeModules.ReplyNotificationModule = originalModule;
    connection.close();
  }
});

test('a definite failed submission is retried while a later success is deduplicated', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const oldState = AppState.currentState;
  const oldModule = NativeModules.ReplyNotificationModule;
  const submit = jest
    .fn()
    .mockResolvedValueOnce('failed')
    .mockResolvedValue('submitted');
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'background',
  });
  NativeModules.ReplyNotificationModule = {
    read: async () => ({ enabled: true, preview: true }),
    authorized: async () => true,
    lease: async () => ({ global: 0, session: 0 }),
    submit,
  };
  try {
    await runMigrations(connection.database);
    const store = createConversationArtifactStorage(connection.database);
    await store.createSession('session', await store.currentGeneration());
    const request = {
      id: 'request',
      sessionId: 'session',
      sessionVersion: 0,
      question: '합성 질문',
      createdAt: '2026-11-13T00:00:00.000Z',
    };
    await store.startRequest(request);
    await store.append({
      ...request,
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      answer: '합성 답변',
      sources: [],
    });
    const consume = createReplyCompletionConsumer(
      store,
      createReplyNotificationLedger(connection.database),
    );
    await consume(request.id);
    await consume(request.id);
    await consume(request.id);
    expect(submit).toHaveBeenCalledTimes(2);
  } finally {
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: oldState,
    });
    NativeModules.ReplyNotificationModule = oldModule;
    connection.close();
  }
});
