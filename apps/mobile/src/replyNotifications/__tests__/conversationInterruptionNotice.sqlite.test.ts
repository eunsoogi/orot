import { AppState, NativeModules } from 'react-native';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { notifyConversationInterruption } from '../notifyConversationInterruption';
import { readInterruptedReply } from '../readInterruptedReply';

test('only an interrupted protected checkpoint can notify; opt-out and foreground suppress it', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const state = AppState.currentState;
  const original = NativeModules.ReplyNotificationModule;
  const interrupt = jest.fn().mockResolvedValue('submitted');
  const save = jest.fn();
  let enabled = true;
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'background',
  });
  NativeModules.ReplyNotificationModule = {
    read: async () => ({ enabled, preview: true }),
    authorized: async () => true,
    lease: async () => ({ global: 0, session: 0 }),
    interrupt,
    save,
  };
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    await storage.startRequest({
      id: 'request',
      sessionId: 'session',
      sessionVersion: 0,
      question: 'PRIVATE QUESTION MUST NOT LEAVE STORAGE',
      createdAt: '2026-11-14T00:00:00.000Z',
    });
    const request = {
      requestId: 'request',
      sessionId: 'session',
      sessionVersion: 0,
    };
    await notifyConversationInterruption(storage, request);
    expect(interrupt).not.toHaveBeenCalled();
    await storage.interruptRequest(
      'request',
      'session',
      0,
      'interrupted',
      'expired',
    );
    await notifyConversationInterruption(storage, request);
    expect(interrupt).toHaveBeenCalledTimes(1);
    const identity = interrupt.mock.calls[0]![0];
    expect(identity.purpose).toBe('interruption');
    expect(JSON.stringify(identity)).not.toContain('PRIVATE');
    expect(await readInterruptedReply(storage, identity)).toEqual({
      createdAt: '2026-11-14T00:00:00.000Z',
      answer: '',
    });
    expect(
      await readInterruptedReply(storage, { ...identity, sessionVersion: 1 }),
    ).toBeNull();
    enabled = false;
    await notifyConversationInterruption(storage, request);
    enabled = true;
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    await notifyConversationInterruption(storage, request);
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    await storage.hideSession('session', 0);
    expect(await readInterruptedReply(storage, identity)).toBeNull();
  } finally {
    NativeModules.ReplyNotificationModule = original;
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: state,
    });
    connection.close();
  }
});
