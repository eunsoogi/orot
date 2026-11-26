import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import type { AnswerMemoryTerminalOperation } from '../conversationAnswerMemoryTerminalReceipt';

const original = {
  id: 'synthetic-original',
  sessionId: 'synthetic-session',
  sessionVersion: 0,
  createdAt: '2026-11-25T00:00:00.000Z',
  question: 'Synthetic original question',
};
const currentRequest = {
  ...original,
  id: 'synthetic-current',
  createdAt: '2026-11-25T00:00:01.000Z',
  question: 'Synthetic explicit bookmark request',
};
const op: AnswerMemoryTerminalOperation = {
  operationRunId: 'synthetic-run',
  operationKey: 'tool-2',
  toolId: 'remember-conversation-answer',
  toolVersion: '1',
};

async function setup() {
  const fixture = await healthContextFixture();
  const storage = createConversationArtifactStorage(fixture.database);
  try {
    await storage.createSession(
      original.sessionId,
      await storage.currentGeneration(),
    );
    await storage.startRequest(original);
    await storage.append({
      id: original.id,
      sessionId: original.sessionId,
      createdAt: original.createdAt,
      question: original.question,
      providerId: 'synthetic-device-model',
      modelId: 'synthetic-model',
      answer: 'Synthetic original answer',
      status: 'complete',
      sources: fixture.saved.sources,
    });
    await storage.startRequest(currentRequest);
    let live = true;
    return {
      ...fixture,
      storage,
      retire: () => {
        live = false;
      },
      input: {
        id: original.id,
        owner: { id: original.sessionId, version: original.sessionVersion },
        currentRequestId: currentRequest.id,
        current: () => live,
      },
    };
  } catch (error) {
    fixture.close();
    throw error;
  }
}

it('binds a new local bookmark to one exact operation and denies changed sources', async () => {
  const f = await setup();
  try {
    const prepared = await f.storage.prepareAnswerMemory(f.input, op);
    const other = { ...op, operationRunId: 'other-run' };
    expect(await prepared?.confirmTerminalCommit(op)).toBeUndefined();
    expect(await prepared?.commit(other)).toBe(false);
    expect(await prepared?.commit({ ...op, operationKey: 'tool-3' })).toBe(
      false,
    );
    expect(await prepared?.commit(op)).toBe(true);
    expect(await prepared?.confirmTerminalCommit(other)).toBeUndefined();
    // The receipt fence denies replay while the request is still active.
    const again = await f.storage.prepareAnswerMemory(f.input, op);
    expect(await again?.commit(op)).toBe(false);
    expect(await prepared?.confirmTerminalCommit(op)).toBe('saved');
    // Confirmation closes the exact request so it cannot prepare again.
    expect(await f.storage.prepareAnswerMemory(f.input, op)).toBeUndefined();
    await f.repository.delete('health_observation', f.inside.id);
    await expect(prepared?.confirmTerminalCommit(op)).resolves.toBeUndefined();
    expect(await f.storage.listSavedConversationAnswers()).toEqual([]);
  } finally {
    f.close();
  }
});

it('an older bookmark cannot prove a new action or bless a retired request', async () => {
  const f = await setup();
  try {
    const legacy = await f.storage.prepareAnswerMemory(f.input);
    expect(await legacy?.commit()).toBe(true);
    const prepared = await f.storage.prepareAnswerMemory(f.input, op);
    expect(await prepared?.commit(op)).toBe(false);
    expect(await prepared?.confirmTerminalCommit(op)).toBe('already_saved');
    f.retire();
    expect(await f.storage.prepareAnswerMemory(f.input, op)).toBeUndefined();
    expect(await f.storage.listSavedConversationAnswers()).toHaveLength(1);
  } finally {
    f.close();
  }
});
