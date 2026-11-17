import { createConversationSessions } from '../conversationSessions';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationSessionRestoreState } from '../conversationSessionRestoreState';
import { decodeConversationArtifact } from '../../storage/conversationArtifactCodec';

const opening = { callId: 'model-opening', text: '질문에 맞춰 살펴볼게요.' };
const event = { type: 'initial_response' as const, ...opening };

// Synthetic model events prove ownership and storage wiring, not model output quality.
test('preserves one opening through streaming, completion, protected save and restore', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => `id-${++sequence}`,
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const store = createConversationSessions({ retention });
    store.setDraft(1, 'question');
    await store.send(1, async (_question, _history, signal, observer) => {
      observer!.onTaskStreamEvent!(event);
      observer!.onTaskStreamEvent!({
        ...event,
        callId: 'duplicate',
        text: 'duplicate',
      });
      observer!.onTaskStreamEvent!({ type: 'text_delta', text: 'answer' });
      expect(
        store.getSnapshot().sessions[0]?.pendingMessage?.initialResponse,
      ).toEqual(opening);
      await observer!.onRetentionCandidate!(
        {
          question: 'question',
          answer: 'answer',
          providerId: 'provider',
          modelId: 'model',
          sources: f.saved.sources,
          citations: [f.saved.sources[0]!.reference],
        },
        signal!,
      );
      return { status: 'answer', answer: 'answer', citations: [] };
    });
    const messages = store.getSnapshot().sessions[0]!.messages;
    expect(messages.map(item => item.content)).toEqual(['question', 'answer']);
    expect(messages[1]!.initialResponse).toEqual(opening);
    const saved = await storage.read('id-2');
    expect(saved?.initialResponse).toEqual(opening);
    expect(saved?.answer).toBe('answer');
    const update = jest.fn();
    const restore = createConversationSessionRestoreState({
      read: async () => [
        {
          question: saved!.question,
          answer: saved!.answer,
          initialResponse: saved!.initialResponse,
          citations: [],
        },
      ],
      update,
    });
    await restore.start(2, 'id-1');
    expect(
      update.mock.calls.find(([, change]) => change.messages)?.[1].messages[1]
        .initialResponse,
    ).toEqual(opening);
    store.setDraft(1, 'follow up');
    await store.send(1, async (_question, history) => {
      expect(JSON.stringify(history)).not.toContain(opening.text);
      return { status: 'answer', answer: 'next', citations: [] };
    });
    await storage.deleteSession('id-1');
    expect(await storage.read('id-2')).toBeNull();
    store.dispose();
  } finally {
    f.close();
  }
});

test.each(['stop', 'failure'] as const)(
  'keeps the opening on %s and ignores late events',
  async mode => {
    const store = createConversationSessions();
    store.setDraft(1, 'question');
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let started!: () => void;
    const ready = new Promise<void>(resolve => {
      started = resolve;
    });
    const running = store.send(
      1,
      async (_question, _history, _signal, observer) => {
        observer!.onTaskStreamEvent!(event);
        started();
        await gate;
        if (mode === 'stop')
          observer!.onTaskStreamEvent!({ ...event, text: 'late' });
        return { status: 'failure', kind: 'unavailable' };
      },
    );
    await ready;
    if (mode === 'stop') store.cancel(1);
    release();
    await running;
    expect(
      store
        .getSnapshot()
        .sessions[0]!.messages.filter(item => item.initialResponse),
    ).toHaveLength(1);
    expect(
      store
        .getSnapshot()
        .sessions[0]!.messages.find(item => item.initialResponse)
        ?.initialResponse,
    ).toEqual(opening);
    store.dispose();
  },
);

test('rejects malformed persisted opening metadata while old artifacts remain compatible', () => {
  const artifact = {
    id: 'id',
    sessionId: 'session',
    createdAt: '2026-10-05T00:00:00.000Z',
    providerId: 'provider',
    modelId: 'model',
    status: 'complete',
    question: 'q',
    answer: 'a',
    sources: [],
  };
  expect(decodeConversationArtifact(JSON.stringify(artifact))).not.toBeNull();
  const longOpening = { ...opening, text: 'x'.repeat(10000) };
  expect(
    decodeConversationArtifact(
      JSON.stringify({ ...artifact, initialResponse: longOpening }),
    )?.initialResponse,
  ).toEqual(longOpening);
  for (const initialResponse of [
    null,
    { ...opening, text: '' },
    { ...opening, source: 'receipt' },
  ]) {
    expect(
      decodeConversationArtifact(
        JSON.stringify({ ...artifact, initialResponse }),
      ),
    ).toBeNull();
  }
});

// Deletion while research continues must revoke both visible and deferred metadata.
test('health deletion blocks late opening callbacks and clears retained metadata', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => `id-${++sequence}`,
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const store = createConversationSessions({ retention });
    store.setDraft(1, 'question');
    await store.send(1, async (_question, _history, signal, observer) => {
      observer!.onTaskStreamEvent!(event);
      store.refreshAfterSourceDeletion(
        'healthkit',
        new Set(['synthetic-deleted-record']),
      );
      observer!.onTaskStreamEvent!({ ...event, callId: 'late' });
      expect(
        store.getSnapshot().sessions[0]?.pendingMessage?.initialResponse,
      ).toBeUndefined();
      await observer!.onRetentionCandidate!(
        {
          question: 'question',
          answer: 'independent answer',
          providerId: 'provider',
          modelId: 'model',
          sources: [],
          citations: [],
        },
        signal!,
      );
      return {
        status: 'answer',
        answer: 'independent answer',
        citations: [],
        healthSources: [],
      };
    });
    expect((await storage.read('id-2'))?.initialResponse).toBeUndefined();
    expect((await storage.read('id-2'))?.answer).toBe('independent answer');
    expect(
      store.getSnapshot().sessions[0]?.messages.at(-1)?.initialResponse,
    ).toBeUndefined();
    store.dispose();
  } finally {
    f.close();
  }
});
