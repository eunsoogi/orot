import { createConversationSessions } from '../conversationSessions';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import type { ConversationToolEvent } from '@orot/agent-runtime';

const event: ConversationToolEvent = {
  version: 1,
  operationRunId: 'run',
  callId: 'tool-1',
  toolName: 'local_records',
  order: 1,
  status: 'started',
  inputSummary: { sourceKind: 'personal_record' },
  sources: [],
};

test('an unexpected sender failure closes an already retained tool-only bubble', async () => {
  const sessions = createConversationSessions();
  sessions.setDraft(1, 'Synthetic question');
  await sessions.send(1, async (_question, _history, _signal, observer) => {
    observer!.onToolEvent!(event);
    throw new Error('private sender failure');
  });
  expect(sessions.getSnapshot().sessions[0]?.messages[1]).toMatchObject({
    incomplete: true,
    toolEvents: [{ status: 'failed' }],
  });
  sessions.dispose();
});

test('app-owned send attaches persisted call identity to the final bubble and keeps separate conversations isolated', async () => {
  const f = await healthContextFixture();
  try {
    let next = 0;
    const storage = createConversationArtifactStorage(f.database);
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => `id-${++next}`,
      now: () => '2026-11-06T00:00:00.000Z',
    });
    const sessions = createConversationSessions({ retention });
    sessions.setDraft(1, 'Synthetic question');
    await sessions.send(1, async (_question, _history, _signal, observer) => {
      observer!.onToolEvent!(event);
      sessions.create();
      observer!.onToolEvent!({
        ...event,
        status: 'completed',
        resultSummary: { referenceCount: 0 },
      });
      return { status: 'answer', answer: 'Synthetic answer', citations: [] };
    });
    const first = sessions.getSnapshot().sessions.find(s => s.id === 1)!;
    expect(first.messages[1]).toMatchObject({
      toolMessageId: 'id-2',
      toolEvents: [{ status: 'completed' }],
    });
    expect((await storage.readToolTurns('id-1'))[0]?.toolEvents).toEqual(
      first.messages[1]?.toolEvents,
    );
    expect(
      sessions.getSnapshot().sessions.find(s => s.id === 2)?.messages,
    ).toEqual([]);
    sessions.dispose();
  } finally {
    f.close();
  }
});

test('a failure with tool metadata survives without streamed prose; a late cancelled request cannot terminate its retry', async () => {
  const sessions = createConversationSessions();
  sessions.setDraft(1, 'first');
  let finish!: () => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => {
    started = resolve;
  });
  const old = sessions.send(
    1,
    async (_question, _history, _signal, observer) => {
      observer!.onToolEvent!(event);
      started();
      await new Promise<void>(resolve => {
        finish = resolve;
      });
      observer!.onToolEvent!({ ...event, status: 'completed' });
      return { status: 'failure', kind: 'cancelled' };
    },
  );
  await ready;
  sessions.cancel(1);
  sessions.setDraft(1, 'retry');
  let retryFinish!: () => void;
  let retryStarted!: () => void;
  const retryReady = new Promise<void>(resolve => {
    retryStarted = resolve;
  });
  const retry = sessions.send(
    1,
    async (_question, _history, _signal, observer) => {
      observer!.onToolEvent!({ ...event, operationRunId: 'retry' });
      retryStarted();
      await new Promise<void>(resolve => {
        retryFinish = resolve;
      });
      observer!.onToolEvent!({
        ...event,
        operationRunId: 'retry',
        status: 'failed',
      });
      return { status: 'failure', kind: 'unavailable' };
    },
  );
  await retryReady;
  finish();
  await old;
  expect(
    sessions.getSnapshot().sessions[0]?.pendingMessage?.toolEvents?.[0]?.status,
  ).toBe('started');
  retryFinish();
  await retry;
  expect(
    sessions
      .getSnapshot()
      .sessions[0]?.messages.filter(m => m.role === 'assistant')
      .map(m => m.toolEvents?.[0]?.status),
  ).toEqual(['cancelled', 'failed']);
  sessions.dispose();
});

test('ignores a new tool callback from a cancelled request', async () => {
  const f = await healthContextFixture();
  let next = 0;
  const storage = createConversationArtifactStorage(f.database);
  const retention = createConversationSessionRetention({
    openStorage: async () => storage,
    createId: () => `id-${++next}`,
    now: () => '2026-11-06T00:00:00.000Z',
  });
  const sessions = createConversationSessions({ retention });
  try {
    sessions.setDraft(1, 'first');
    let observer: import('../service').RagConversationObserver | undefined;
    let finish!: () => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => {
      started = resolve;
    });
    const send = sessions.send(1, async (_q, _h, _signal, value) => {
      observer = value;
      started();
      await new Promise<void>(resolve => {
        finish = resolve;
      });
      return { status: 'failure', kind: 'cancelled' };
    });
    await ready;
    sessions.cancel(1);
    observer!.onToolEvent!({ ...event, callId: 'late' });
    finish();
    await send;
    expect(await storage.readToolTurns('id-1')).toEqual([]);
  } finally {
    sessions.dispose();
    f.close();
  }
});
