import type { NativeEventEmitter } from 'react-native';
import { nativeDuplexVoice } from '../../voiceConversation/nativeDuplexVoice';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';
import { conversationHistoryPayload } from '../conversationHistoryPayload';

async function fixture() {
  const f = openSqliteTestDatabase(':memory:');
  await runMigrations(f.database);
  const storage = createConversationArtifactStorage(f.database);
  let serial = 0;
  const retention = createConversationSessionRetention({
    openStorage: async () => storage,
    createId: () => `voice-owner-${++serial}`,
    now: () => '2026-11-20T05:00:00.000Z',
  });
  const store = createConversationSessions({
    retention,
    restoreSession: async () => [],
    restoreTasks: async id =>
      storage.readTaskCards(id, (await storage.activeSessionVersion(id))!),
  });
  return { f, store, storage, retention };
}

test('an owned terminal marker attaches to the original protected session without selecting it or creating a model message', async () => {
  const { f, store, storage, retention } = await fixture();
  try {
    const home = store.getSnapshot().activeId;
    const complete = store.captureVoiceEnd(home, 'realtime-1-1')!;
    expect(await storage.listSessions()).toMatchObject({ items: [] });
    store.create();
    const next = store.getSnapshot().activeId;
    expect(next).not.toBe(home);
    expect(store.captureVoiceEnd(home, 'realtime-2-2')).toBeUndefined();
    store.setDraft(next, 'keep the unrelated draft');
    await complete({ callId: 'realtime-1-1', durationSeconds: 134 });
    await complete({ callId: 'realtime-1-1', durationSeconds: 134 });
    const view = store.getSnapshot();
    expect(view.activeId).toBe(next);
    const original = view.sessions.find(session => session.id === home)!;
    expect(original.taskCards).toEqual([
      expect.objectContaining({
        id: 'voice-end:realtime-1-1',
        task: { kind: 'voice_end', durationSeconds: 134 },
      }),
    ]);
    expect(view.sessions.find(session => session.id === next)?.draft).toBe(
      'keep the unrelated draft',
    );
    expect(conversationHistoryPayload(original.messages, 'new text')).toEqual(
      [],
    );
    const lease = retention.activeLease(home)!;
    expect(await storage.readTaskCards(lease.id, lease.version)).toEqual([
      expect.objectContaining({
        id: 'voice-end:realtime-1-1',
        task: { kind: 'voice_end', durationSeconds: 134 },
      }),
    ]);
    expect(retention.activeLease(next)).toBeNull();
    const freshRetention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => 'new-restore-only',
      now: () => original.createdAt,
    });
    const fresh = createConversationSessions({
      retention: freshRetention,
      restoreSession: async () => [],
      restoreTasks: id => storage.readTaskCards(id, lease.version),
    });
    try {
      const restoredId = await fresh.attachExisting(
        lease.id,
        lease.version,
        original.createdAt,
        true,
      );
      const restored = fresh
        .getSnapshot()
        .sessions.find(session => session.id === restoredId)!;
      expect(restored.messages).toEqual([]);
      expect(restored.title).not.toBe('일일 보고서');
      expect(restored.taskCards).toEqual([
        expect.objectContaining({
          id: 'voice-end:realtime-1-1',
          task: { kind: 'voice_end', durationSeconds: 134 },
        }),
      ]);
    } finally {
      fresh.dispose();
    }
  } finally {
    store.dispose();
    f.close();
  }
});

test('deletion and undo revoke preexisting and previously empty voice capabilities', async () => {
  const { f, store, storage, retention } = await fixture();
  try {
    let home = store.getSnapshot().activeId;
    const fromEmpty = store.captureVoiceEnd(home, 'realtime-1-1')!;
    await store.remove(home);
    await store.undoRemove();
    expect(
      fromEmpty({ callId: 'realtime-1-1', durationSeconds: 1 }),
    ).toBeUndefined();
    expect(await storage.listSessions()).toMatchObject({ items: [] });

    home = store.getSnapshot().activeId;
    const before = await retention.beginSession(
      home,
      new AbortController().signal,
    );
    const fromRetained = store.captureVoiceEnd(home, 'realtime-1-2')!;
    await store.remove(home);
    await store.undoRemove();
    expect(
      fromRetained({ callId: 'realtime-1-2', durationSeconds: 1 }),
    ).toBeUndefined();
    const version = (await storage.activeSessionVersion(before.id))!;
    expect(version).not.toBe(before.version);
    expect(await storage.readTaskCards(before.id, version)).toEqual([]);
  } finally {
    store.dispose();
    f.close();
  }
});

test('the local native stop bridge persists a real receipt in a first voice-only chat, not an empty or denied call', async () => {
  const { f, store, storage } = await fixture();
  const sessionId = store.getSnapshot().activeId;
  const denied = 'voice-1-1-call-1';
  const connected = 'voice-1-2-call-2';
  const module = {
    openCall: jest.fn(async () => {}),
    stopCall: jest.fn(async (id: string) =>
      id === connected ? { callId: id, durationSeconds: 13 } : null,
    ),
    interruptOutput: jest.fn(async () => {}),
    speakCall: jest.fn(async () => true),
    finishCallCapture: jest.fn(),
  };
  const adapter = nativeDuplexVoice(module, {} as NativeEventEmitter, id =>
    store.captureVoiceEnd(sessionId, id),
  );
  try {
    await adapter.open(denied, 'ko');
    await adapter.stop(denied);
    expect(await storage.listSessions()).toMatchObject({ items: [] });
    await adapter.open(connected, 'ko');
    expect(await storage.listSessions()).toMatchObject({ items: [] });
    const persisted = new Promise<void>(resolve => {
      const unsubscribe = store.subscribe(() => {
        if (store.getSnapshot().sessions[0]?.taskCards?.length === 1) {
          unsubscribe();
          resolve();
        }
      });
    });
    await adapter.stop(connected);
    await persisted;
    await adapter.stop(connected);
    expect(store.getSnapshot().sessions[0]?.taskCards).toEqual([
      expect.objectContaining({
        id: `voice-end:${connected}`,
        task: { kind: 'voice_end', durationSeconds: 13 },
      }),
    ]);
    expect(store.getSnapshot().sessions[0]?.messages).toEqual([]);
  } finally {
    store.dispose();
    f.close();
  }
});
