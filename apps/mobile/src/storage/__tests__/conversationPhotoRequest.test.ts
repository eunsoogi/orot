import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import type { ConversationSubmittedInput } from '../../ragConversation/conversationSubmittedInput';

const input: ConversationSubmittedInput = {
  schemaVersion: 1,
  inputRevision: 2,
  sessionId: 'session',
  requestId: 'request',
  question: '',
  ocr: {
    providerId: 'provider',
    modelId: 'model',
    recipient: 'recipient',
    remoteProcessing: true,
    consentScope: {
      purpose: 'conversation',
      policyVersion: 'v1',
      dataCategories: ['ocr'],
    },
    source: {
      id: '12345678-1234-4234-8234-123456789abc',
      contentHash: `sha256:${'a'.repeat(64)}`,
    },
    deletionGeneration: 3,
    sections: [
      { id: 'section', text: 'Synthetic OCR', startOffset: 0, endOffset: 13 },
    ],
  },
};
const request = {
  id: input.requestId,
  sessionId: input.sessionId,
  sessionVersion: 0,
  question: input.question,
  createdAt: '2026-11-13T00:00:00.000Z',
  submittedInput: input,
};
const answer = {
  id: input.requestId,
  sessionId: input.sessionId,
  question: input.question,
  createdAt: request.createdAt,
  providerId: 'provider',
  modelId: 'model',
  status: 'complete' as const,
  answer: 'Synthetic answer',
  sources: [],
  submittedInput: input,
};

test('photo-only input remains distinct from its answer and a source invalidation fences later results', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const store = createConversationArtifactStorage(connection.database);
    await store.createSession('session', await store.currentGeneration());
    await store.startRequest(request);
    expect(await store.readRequestInput('request', 'session', 0)).toEqual(
      input,
    );
    expect(await store.retainedRequestSourceIds()).toEqual([
      '12345678-1234-4234-8234-123456789abc',
    ]);
    await expect(
      store.append({ ...answer, providerId: 'other' }),
    ).rejects.toThrow();
    await expect(
      store.append({
        ...answer,
        submittedInput: { ...input, inputRevision: 3 },
      }),
    ).rejects.toThrow();
    for (const changed of [
      {
        ...input,
        ocr: {
          ...input.ocr!,
          consentScope: {
            ...input.ocr!.consentScope,
            policyVersion: 'changed',
          },
        },
      },
      { ...input, ocr: { ...input.ocr!, deletionGeneration: 4 } },
      {
        ...input,
        ocr: {
          ...input.ocr!,
          source: {
            ...input.ocr!.source,
            contentHash: `sha256:${'b'.repeat(64)}`,
          },
        },
      },
      {
        ...input,
        ocr: {
          ...input.ocr!,
          sections: [{ ...input.ocr!.sections[0]!, text: 'Altered OCR' }],
        },
      },
    ])
      await expect(
        store.append({ ...answer, submittedInput: changed }),
      ).rejects.toThrow();
    expect(await store.listCompletionIdentities()).toEqual([]);
    await store.append(answer);
    expect(await store.read('request')).toEqual(answer);
    expect(await store.listCompletionIdentities()).toHaveLength(1);
    await store.invalidateRequestSource('12345678-1234-4234-8234-123456789abc');
    expect(await store.readRequestInput('request', 'session', 0)).toBeNull();
    expect(await store.read('request')).toBeNull();
    expect(await store.retainedRequestSourceIds()).toEqual([]);
    expect(await store.listCompletionIdentities()).toEqual([]);
    await expect(store.append(answer)).rejects.toThrow();
  } finally {
    connection.close();
  }
});

test('invalidating a pending source erases its input and rejects a late completion', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const store = createConversationArtifactStorage(connection.database);
    await store.createSession('session', await store.currentGeneration());
    await store.startRequest(request);
    await store.invalidateRequestSource('12345678-1234-4234-8234-123456789abc');
    const rows = await connection.database.execute(
      'SELECT question, input_json, status FROM conversation_requests WHERE id = ?',
      ['request'],
    );
    expect(rows.rows).toEqual([
      { question: '', input_json: null, status: 'cancelled' },
    ]);
    await expect(store.append(answer)).rejects.toThrow();
    const nextInput = { ...input, requestId: 'next-request' };
    await expect(
      store.startRequest({
        ...request,
        id: 'next-request',
        submittedInput: nextInput,
      }),
    ).rejects.toThrow();
  } finally {
    connection.close();
  }
});

test('checkpoint snapshots the submitted input before asynchronous storage work', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const store = createConversationArtifactStorage(connection.database);
    await store.createSession('session', await store.currentGeneration());
    const mutable = JSON.parse(JSON.stringify(input));
    const pending = store.startRequest({ ...request, submittedInput: mutable });
    mutable.ocr.sections[0].text = 'Changed after submission';
    await pending;
    expect(await store.readRequestInput('request', 'session', 0)).toEqual(
      input,
    );
  } finally {
    connection.close();
  }
});

test('a malformed session lease cannot create a protected photo request', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const store = createConversationArtifactStorage(connection.database);
    await store.createSession('session', await store.currentGeneration());
    await expect(
      store.startRequest({
        ...request,
        sessionVersion: '0' as unknown as number,
      }),
    ).rejects.toThrow('Invalid conversation request');
    expect(await store.retainedRequestSourceIds()).toEqual([]);
  } finally {
    connection.close();
  }
});

test('delete undo retains a photo source while rejecting the old request lease', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const store = createConversationArtifactStorage(connection.database);
    await store.createSession('session', await store.currentGeneration());
    await store.startRequest(request);
    const hidden = await store.hideSession('session', 0);
    expect(await store.retainedRequestSourceIds()).toEqual([
      input.ocr!.source.id,
    ]);
    expect(await store.undoHiddenSession('session', hidden!)).toBe(2);
    expect(await store.readRequestInput('request', 'session', 2)).toEqual(
      input,
    );
    expect(await store.listInterruptedRequests('session', 2)).toMatchObject([
      { id: 'request', submittedInput: input },
    ]);
    await expect(store.append(answer, undefined, 0)).rejects.toThrow();
    expect(await store.listCompletionIdentities()).toEqual([]);
  } finally {
    connection.close();
  }
});

test('delete undo keeps a committed photo answer and its stable completion identity', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const store = createConversationArtifactStorage(connection.database);
    await store.createSession('session', await store.currentGeneration());
    await store.startRequest(request);
    await store.append(answer);
    const hidden = await store.hideSession('session', 0);
    expect(await store.retainedRequestSourceIds()).toEqual([
      input.ocr!.source.id,
    ]);
    expect(await store.listCompletionIdentities()).toEqual([]);
    await store.undoHiddenSession('session', hidden!);
    expect(await store.read('request')).toEqual(answer);
    expect(await store.listCompletionIdentities()).toEqual([
      {
        requestId: 'request',
        sessionId: 'session',
        messageId: 'request',
        sessionVersion: 2,
        status: 'completed',
      },
    ]);
    await expect(store.append(answer, undefined, 0)).rejects.toThrow();
  } finally {
    connection.close();
  }
});
