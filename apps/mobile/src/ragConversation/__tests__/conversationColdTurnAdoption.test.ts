import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationRequestLifetime } from '../conversationRequestLifetime';

async function fixture() {
  const f = await healthContextFixture();
  const storage = createConversationArtifactStorage(f.database);
  const createdAt = '2026-11-14T00:00:00.000Z';
  await storage.createSession(
    'saved-session',
    await storage.currentGeneration(),
  );
  await storage.startRequest({
    id: 'saved-request',
    sessionId: 'saved-session',
    sessionVersion: 0,
    question: 'Synthetic original',
    createdAt,
  });
  await storage.interruptRequest(
    'saved-request',
    'saved-session',
    0,
    'interrupted',
    'decision-required',
  );
  const createId = jest.fn(() => 'unexpected-new-id');
  const retention = createConversationSessionRetention({
    openStorage: async () => storage,
    createId,
    now: () => '2026-11-15T00:00:00.000Z',
  });
  await retention.attachExisting(1, 'saved-session', 0);
  return { ...f, storage, retention, createId, createdAt };
}

test('adoption keeps original request and output identity without starting another turn', async () => {
  const f = await fixture();
  try {
    const turn = await f.retention.adoptTurn(
      1,
      'saved-request',
      new AbortController().signal,
    );
    expect(turn.toolMessageId).toBe('saved-request');
    expect(f.createId).not.toHaveBeenCalled();
    await expect(
      turn.startRequest('changed', new AbortController().signal),
    ).rejects.toThrow('resubmitted');
    await expect(
      f.retention.adoptTurn(1, 'saved-request', new AbortController().signal),
    ).rejects.toThrow();
    // This test isolates retention; the real cold runner owns the separately tested atomic activation.
    await f.database.execute(
      "UPDATE conversation_requests SET status = 'active' WHERE id = 'saved-request'",
    );
    await turn.save(
      {
        question: 'Synthetic original',
        answer: 'Synthetic retained answer',
        providerId: 'provider',
        modelId: 'model',
        sources: f.saved.sources,
        citations: [f.saved.sources[0]!.reference],
      },
      new AbortController().signal,
    );
    expect(await f.storage.read('saved-request')).toMatchObject({
      id: 'saved-request',
      createdAt: f.createdAt,
    });
    expect(
      (await f.database.execute('SELECT id FROM conversation_requests')).rows,
    ).toEqual([{ id: 'saved-request' }]);
  } finally {
    f.close();
  }
});

test('unknown sessions, stopped turns and concurrent adoption never allocate replacement identities', async () => {
  const f = await fixture();
  try {
    await expect(
      f.retention.adoptTurn(99, 'saved-request', new AbortController().signal),
    ).rejects.toThrow();
    const claims = await Promise.allSettled(
      [1, 2].map(() =>
        f.retention.adoptTurn(1, 'saved-request', new AbortController().signal),
      ),
    );
    expect(claims.filter(value => value.status === 'fulfilled')).toHaveLength(
      1,
    );
    await f.storage.interruptRequest(
      'saved-request',
      'saved-session',
      0,
      'interrupted',
      'user-stopped',
    );
    const fresh = createConversationSessionRetention({
      openStorage: async () => f.storage,
      createId: f.createId,
      now: () => '',
    });
    await fresh.attachExisting(2, 'saved-session', 0);
    await expect(
      fresh.adoptTurn(2, 'saved-request', new AbortController().signal),
    ).rejects.toThrow();
    expect(f.createId).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});

test('cold lifetime acquires ownership without request creation and still fences Stop', async () => {
  const f = await fixture();
  try {
    const turn = await f.retention.adoptTurn(
      1,
      'saved-request',
      new AbortController().signal,
    );
    const start = jest.spyOn(turn, 'startRequest');
    const lifetime = createConversationRequestLifetime({
      interrupt: jest.fn(),
      reportFenceFailure: jest.fn(),
    });
    const controller = new AbortController();
    await lifetime.resume(1, controller, turn, 1);
    expect(start).not.toHaveBeenCalled();
    await expect(
      lifetime.resume(1, new AbortController(), turn, 1),
    ).rejects.toThrow('owned');
    lifetime.interrupt(1, 'cancelled');
    controller.abort();
    await lifetime.settle(1, controller);
    expect(await f.storage.listInterruptedRequests('saved-session', 0)).toEqual(
      [
        expect.objectContaining({
          id: 'saved-request',
          interruptionReason: 'user-stopped',
        }),
      ],
    );
  } finally {
    f.close();
  }
});

test('a cancelled preclaim adoption can release ownership and retry without replacing its request', async () => {
  const f = await fixture();
  try {
    const controller = new AbortController();
    const first = await f.retention.adoptTurn(
      1,
      'saved-request',
      controller.signal,
    );
    expect(f.retention.releaseAdoptedTurn(1, first)).toBe(false);
    controller.abort();
    expect(f.retention.releaseAdoptedTurn(1, first)).toBe(true);
    const next = await f.retention.adoptTurn(
      1,
      'saved-request',
      new AbortController().signal,
    );
    expect(next.toolMessageId).toBe(first.toolMessageId);
    expect(f.retention.releaseAdoptedTurn(1, first)).toBe(false);
    expect(f.createId).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});
