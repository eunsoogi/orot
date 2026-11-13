import { AppState, NativeModules } from 'react-native';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createReplyNotificationStorage } from '../replyNotificationStorage';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';

test('a saved answer survives native failure and session deletion clears notifications', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const oldState = AppState.currentState;
  const oldModule = NativeModules.ReplyNotificationModule;
  const removeSession = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'background',
  });
  NativeModules.ReplyNotificationModule = {
    read: async () => ({ enabled: true, preview: true }),
    authorized: async () => true,
    lease: async () => ({ global: 0, session: 0 }),
    submit: async () => {
      throw new Error('synthetic native failure');
    },
    removeSession,
  };
  try {
    await runMigrations(connection.database);
    const store = createReplyNotificationStorage(
      createConversationArtifactStorage(connection.database),
      connection.database,
    );
    await store.createSession('session', await store.currentGeneration());
    const request = {
      id: 'request',
      sessionId: 'session',
      sessionVersion: 0,
      question: '질문',
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
    expect((await store.read('request'))?.answer).toBe('합성 답변');
    await store.hideSession('session', 0);
    expect(removeSession).toHaveBeenCalledWith('session');
    expect(await store.read('request')).toBeNull();
  } finally {
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: oldState,
    });
    NativeModules.ReplyNotificationModule = oldModule;
    connection.close();
  }
});

test('a source deletion during notification preparation invalidates the pending preview', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const oldState = AppState.currentState;
  const oldModule = NativeModules.ReplyNotificationModule;
  let resume: (value: {
    enabled: boolean;
    preview: boolean;
  }) => void = () => {};
  let started: () => void = () => {};
  const reading = new Promise<void>(resolve => {
    started = resolve;
  });
  const preference = new Promise<{ enabled: boolean; preview: boolean }>(
    resolve => {
      resume = resolve;
    },
  );
  const submit = jest.fn();
  const removeAll = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'background',
  });
  NativeModules.ReplyNotificationModule = {
    read: () => {
      started();
      return preference;
    },
    authorized: async () => true,
    lease: async () => ({ global: 0, session: 0 }),
    submit,
    removeAll,
  };
  try {
    await runMigrations(connection.database);
    const store = createReplyNotificationStorage(
      createConversationArtifactStorage(connection.database),
      connection.database,
    );
    await store.createSession('session', await store.currentGeneration());
    const request = {
      id: 'request',
      sessionId: 'session',
      sessionVersion: 0,
      question: '질문',
      createdAt: '2026-11-13T00:00:00.000Z',
    };
    await store.startRequest(request);
    const saving = store.append({
      ...request,
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      answer: '합성 답변',
      sources: [],
    });
    await reading;
    notifyLocalSourceDeleted();
    resume({ enabled: true, preview: true });
    await saving;
    expect(removeAll).toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: oldState,
    });
    NativeModules.ReplyNotificationModule = oldModule;
    connection.close();
  }
});
