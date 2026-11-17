import { createConversationSessions } from '../conversationSessions';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { quarantinedHistoryFixture } from '../../aiFeatures/integration/testSupport/quarantinedHistoryFixture';
import { conversationHistoryPageOption } from '../../aiFeatures/integration/conversationHistoryPageOption';
import { restoreConversationSteering } from '../../aiFeatures/integration/restoreConversationSteering';
import { createConversationPagedRestoreState } from '../conversationPagedRestoreState';
import { createEmptyConversation } from '../conversationEmptySession';

async function fixture() {
  const f = await quarantinedHistoryFixture();
  // OP-SQLite serializes transactions; the raw node:sqlite test adapter does not.
  const transaction = f.database.transaction.bind(f.database);
  let tail = Promise.resolve();
  f.database.transaction = operation => {
    const run = tail.then(() => transaction(operation));
    tail = run.catch(() => {});
    return run;
  };
  for (let index = 0; index < 11; index++)
    await f.database.execute(
      "INSERT INTO conversation_requests (id, session_id, session_version, question, created_at, status) VALUES (?, 'session', 0, 'Synthetic interrupted question', ?, 'interrupted')",
      [`pending-${String(index).padStart(2, '0')}`, '2026-11-01T00:00:00.000Z'],
    );
  let session = createEmptyConversation(1);
  const errors: Error[] = [];
  const readPage = conversationHistoryPageOption(f.input, f.open);
  const read = jest.fn(async (...args: Parameters<typeof readPage>) => {
    try {
      return await readPage(...args);
    } catch (error) {
      errors.push(error as Error);
      throw error;
    }
  });
  const state = createConversationPagedRestoreState({
    read,
    readSteering: restoreConversationSteering(f.open),
    find: () => session,
    update: (_id, change) => {
      session = { ...session, ...change };
    },
  });
  return { ...f, read, errors, state, current: () => session };
}

// Actual SQLite page/steering adapters, not a mock cursor, exercise the app's restore boundary.
test('eleven interrupted turns cross a real ten-row page and terminate with fewer than eight valid messages', async () => {
  const f = await fixture();
  try {
    await f.state.start(1, 'session');
    if (f.errors.length) throw f.errors[0];
    expect(f.current().historyHasMore).toBe(true);
    expect(f.current().restoreFailed).toBe(false);
    expect(await f.state.prepareContext(1)).toBe(true);
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(f.current().historyHasMore).toBe(false);
    expect(
      f
        .current()
        .messages.filter(message => !message.incomplete && !message.failed),
    ).toHaveLength(4);
    expect(f.errors).toEqual([]);
  } finally {
    f.state.dispose();
    f.close();
  }
});

test('stable quarantine notice on the final real page does not block context preparation', async () => {
  const f = await fixture();
  try {
    await f.quarantine();
    await f.state.start(1, 'session');
    expect(await f.state.prepareContext(1)).toBe(true);
    expect(
      f.current().messages.filter(message => message.historyUnavailable),
    ).toHaveLength(1);
    expect(f.errors).toEqual([]);
  } finally {
    f.state.dispose();
    f.close();
  }
});

test('a changed durable lease with an old page cursor repeatedly fails until the page owner is restarted', async () => {
  const f = await fixture();
  try {
    await f.state.start(1, 'session');
    const hidden = await f.storage.hideSession('session');
    const version = await f.storage.undoHiddenSession('session', hidden!);
    expect(version).not.toBe(0);
    expect(await f.state.prepareContext(1)).toBe(false);
    expect(f.errors.map(error => error.message)).toEqual([
      'Invalid conversation timeline cursor.',
      'Invalid conversation timeline cursor.',
    ]);
    expect(f.current().historyLoadFailed).toBe(true);
    expect(await f.state.prepareContext(1)).toBe(false);
    expect(f.errors).toHaveLength(3);
    await f.state.start(1, 'session');
    expect(await f.state.prepareContext(1)).toBe(true);
  } finally {
    f.state.dispose();
    f.close();
  }
});

test('continuous selection rebinds a same-ID new lease and validates fresh pages before sending', async () => {
  const f = await fixture();
  const store = createConversationSessions({
    continuousSession: async () => ({
      id: 'session',
      version: (await f.storage.activeSessionVersion('session'))!,
      updatedAt: '2026-11-01T00:00:00.000Z',
      model: { providerId: 'synthetic', modelId: 'synthetic' },
    }),
    retention: createConversationSessionRetention({
      openStorage: f.open,
      createId: () => 'synthetic-new',
      now: () => '2026-11-02T00:00:00.000Z',
    }),
    restoreSession: async () => [],
    restoreSessionPage: f.read,
    restoreSteering: restoreConversationSteering(f.open),
  });
  try {
    await store.synchronizeModel();
    const id = store.getSnapshot().activeId;
    const hidden = await f.storage.hideSession('session');
    await f.storage.undoHiddenSession('session', hidden!);
    expect(await store.prepareSend(id)).toBe(true);
    const send = jest.fn(async () => ({
      status: 'answer' as const,
      answer: 'Synthetic response',
      citations: [],
    }));
    store.setDraft(id, 'Synthetic new question');
    await store.send(id, send);
    const session = store.getSnapshot().sessions.find(item => item.id === id)!;
    expect(send).toHaveBeenCalledTimes(1);
    expect(session.modelSelectionFailed).toBe(false);
    expect(session.historyLoadFailed).toBe(false);
    expect(session.error).not.toContain('전송하지 않았어요');
    expect(store.toolSourceSessionId(id)).toBe('session');
    expect(f.errors).toEqual([]);
    const calls = f.read.mock.calls.length;
    await store.synchronizeModel();
    expect(f.read).toHaveBeenCalledTimes(calls);
  } finally {
    store.dispose();
    f.state.dispose();
    f.close();
  }
});

test('a missing page owner cannot certify a failed or partially rebound history', async () => {
  for (const failure of [
    { restoreFailed: true },
    { leaseRefreshRequired: true },
  ]) {
    const state = createConversationPagedRestoreState({
      read: jest.fn(),
      find: () => ({ ...createEmptyConversation(1), ...failure }),
      update: jest.fn(),
    });
    expect(await state.prepareContext(1)).toBe(false);
    state.dispose();
  }
});
