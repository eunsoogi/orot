import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationPhotoImport } from '../conversationPhotoImport';
import { commitConversationPhotoCheckpoint } from '../conversationPhotoCheckpoint';
import { createConversationPhotoRetirement } from '../conversationPhotoRetirement';
import type { ConversationSubmittedInput } from '../conversationSubmittedInput';

test('removal during protected handoff fences the request before native cleanup', async () => {
  const db = openSqliteTestDatabase(':memory:');
  const doc = {
    id: '12345678-1234-4234-8234-123456789abc',
    displayName: 'synthetic.jpg',
    contentHash: `sha256:${'a'.repeat(64)}` as const,
    sections: [
      { id: 'section', text: 'synthetic', startOffset: 0, endOffset: 9 },
    ],
  };
  const submitted: ConversationSubmittedInput = {
    schemaVersion: 1,
    inputRevision: 1,
    sessionId: 'session',
    requestId: 'request',
    question: '',
    ocr: {
      providerId: 'provider',
      modelId: 'model',
      recipient: 'recipient',
      remoteProcessing: false,
      consentScope: {
        purpose: 'conversation',
        policyVersion: 'v1',
        dataCategories: ['ocr'],
      },
      source: { id: doc.id, contentHash: doc.contentHash },
      deletionGeneration: 0,
      sections: doc.sections,
    },
  };
  const drafts = createConversationPhotoImport({
    selectDocument: async () => doc,
    discardDocument: async () => {},
  });
  try {
    await runMigrations(db.database);
    const storage = createConversationArtifactStorage(db.database);
    await storage.createSession('session', await storage.currentGeneration());
    await drafts.select(1);
    const lease = drafts.beginHandoff(1, {
      sessionId: 'session',
      sessionVersion: 0,
      requestId: 'request',
      inputRevision: 1,
    })!;
    let resume!: () => void;
    const gate = new Promise<void>(resolve => {
      resume = resolve;
    });
    const discard = jest.fn(async () => {
      expect(
        await storage.readRequestInput('request', 'session', 0),
      ).toBeNull();
    });
    const handoff = commitConversationPhotoCheckpoint({
      lease,
      submitted,
      storage,
      retire: createConversationPhotoRetirement({
        fence: storage.invalidateRequestSource,
        discard,
      }).retire,
      start: async () => {
        await storage.startRequest({
          id: 'request',
          sessionId: 'session',
          sessionVersion: 0,
          question: '',
          createdAt: '2026-11-13T00:00:00.000Z',
          submittedInput: submitted,
        });
        await gate;
      },
    });
    const removal = drafts.remove(1);
    resume();
    await expect(handoff).rejects.toThrow('removed');
    await removal;
    expect(discard).toHaveBeenCalledWith(doc.id);
    await expect(
      storage.startRequest({
        id: 'other',
        sessionId: 'session',
        sessionVersion: 0,
        question: '',
        createdAt: '2026-11-13T00:00:01.000Z',
        submittedInput: { ...submitted, requestId: 'other' },
      }),
    ).rejects.toThrow();
  } finally {
    db.close();
  }
});

test('an unconfirmed failed write fences cleanup even when rejection has no value', async () => {
  const doc = {
    id: '12345678-1234-4234-8234-123456789abc',
    displayName: 'synthetic.jpg',
    contentHash: `sha256:${'a'.repeat(64)}` as const,
    sections: [
      { id: 'section', text: 'synthetic', startOffset: 0, endOffset: 9 },
    ],
  };
  const drafts = createConversationPhotoImport({
    selectDocument: async () => doc,
    discardDocument: async () => {},
  });
  await drafts.select(1);
  const lease = drafts.beginHandoff(1, {
    sessionId: 'session',
    sessionVersion: 0,
    requestId: 'request',
    inputRevision: 1,
  })!;
  const submitted: ConversationSubmittedInput = {
    schemaVersion: 1,
    inputRevision: 1,
    sessionId: 'session',
    requestId: 'request',
    question: '',
    ocr: {
      providerId: 'provider',
      modelId: 'model',
      recipient: 'recipient',
      remoteProcessing: false,
      consentScope: {
        purpose: 'conversation',
        policyVersion: 'v1',
        dataCategories: ['ocr'],
      },
      source: { id: doc.id, contentHash: doc.contentHash },
      deletionGeneration: 0,
      sections: doc.sections,
    },
  };
  const fence = jest
    .fn()
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValue(undefined);
  const discard = jest.fn().mockResolvedValue(undefined);
  const retirement = createConversationPhotoRetirement({ fence, discard });
  let failed = false;
  try {
    await commitConversationPhotoCheckpoint({
      lease,
      submitted,
      storage: { readRequestInput: async () => null },
      retire: retirement.retire,
      start: () => Promise.reject(undefined),
    });
  } catch {
    failed = true;
  }
  expect(failed).toBe(true);
  expect(retirement.pending()).toEqual([doc.id]);
  expect(discard).not.toHaveBeenCalled();
  expect(drafts.get(1).status).toBe('empty');
  await retirement.retire(doc.id);
  expect(discard).toHaveBeenCalledWith(doc.id);
  expect(retirement.pending()).toEqual([]);
});
