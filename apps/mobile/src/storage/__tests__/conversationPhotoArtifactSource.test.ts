import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { decodeConversationArtifact } from '../conversationArtifactCodec';
import type { ConversationArtifact } from '../conversationArtifactTypes';
import { createConversationSessionRetention } from '../../ragConversation/conversationSessionRetention';

test('a photo citation is tied to its protected request and disappears on source deletion', async () => {
  const db = openSqliteTestDatabase(':memory:');
  const sourceId = '12345678-1234-4234-8234-123456789abc';
  const contentHash = `sha256:${'a'.repeat(64)}` as const;
  const section = {
    id: 'section',
    text: 'synthetic',
    startOffset: 0,
    endOffset: 9,
  };
  const reference = {
    sourceKind: 'personal_record' as const,
    sourceId,
    sourceRevision: contentHash,
    evidenceId: section.id,
    evidenceRevision: fingerprint(section),
    locator: {
      kind: 'conversation_photo',
      requestId: 'request',
      sectionId: section.id,
    },
    effectiveTime: null,
    reviewState: 'unreviewed' as const,
  };
  const submittedInput = {
    schemaVersion: 1 as const,
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
      source: { id: sourceId, contentHash },
      deletionGeneration: 0,
      sections: [section],
    },
  };
  const value: ConversationArtifact = {
    id: 'request',
    sessionId: 'session',
    createdAt: '2026-11-13T00:00:00.000Z',
    providerId: 'provider',
    modelId: 'model',
    status: 'complete',
    question: '',
    answer: 'synthetic',
    submittedInput,
    citations: [reference],
    sources: [
      {
        kind: 'conversation_photo',
        requestId: 'request',
        sectionId: section.id,
        reference,
      },
    ],
  };
  try {
    await runMigrations(db.database);
    const storage = createConversationArtifactStorage(db.database);
    await storage.createSession('session', await storage.currentGeneration());
    await storage.startRequest({
      id: 'request',
      sessionId: 'session',
      sessionVersion: 0,
      question: '',
      createdAt: value.createdAt,
      submittedInput,
    });
    expect(decodeConversationArtifact(JSON.stringify(value))).not.toBeNull();
    expect(
      decodeConversationArtifact(
        JSON.stringify({
          ...value,
          sources: [{ ...value.sources[0], sectionId: 'different' }],
        }),
      ),
    ).toBeNull();
    await storage.append(value);
    expect(await storage.read('request')).not.toBeNull();
    await storage.invalidateRequestSource(sourceId);
    expect(await storage.read('request')).toBeNull();
    await expect(storage.append(value)).rejects.toThrow();
  } finally {
    db.close();
  }
});

test('hidden photo ownership survives undo and finalization returns fenced originals', async () => {
  const db = openSqliteTestDatabase(':memory:');
  const sourceId = '12345678-1234-4234-8234-123456789abc';
  try {
    await runMigrations(db.database);
    const storage = createConversationArtifactStorage(db.database);
    await storage.createSession('session', await storage.currentGeneration());
    const submittedInput = {
      schemaVersion: 1 as const,
      inputRevision: 0,
      sessionId: 'session',
      requestId: 'request',
      question: '',
      ocr: {
        providerId: 'p',
        modelId: 'm',
        recipient: 'device',
        remoteProcessing: false,
        consentScope: {
          purpose: 'conversation',
          policyVersion: 'v1',
          dataCategories: ['ocr'],
        },
        source: {
          id: sourceId,
          contentHash: `sha256:${'a'.repeat(64)}` as const,
        },
        deletionGeneration: 0,
        sections: [{ id: 's', text: 'photo', startOffset: 0, endOffset: 5 }],
      },
    };
    await storage.startRequest({
      id: 'request',
      sessionId: 'session',
      sessionVersion: 0,
      question: '',
      createdAt: '2026-11-13T00:00:00.000Z',
      submittedInput,
    });
    const hidden = await storage.hideSession('session', 0);
    if (hidden === null) throw new Error('Expected hidden session.');
    expect(await storage.retainedRequestSourceIds()).toEqual([sourceId]);
    const restored = await storage.undoHiddenSession('session', hidden);
    const hiddenAgain = await storage.hideSession('session', restored);
    if (hiddenAgain === null) throw new Error('Expected hidden session.');
    const retirePhoto = jest.fn().mockResolvedValue(undefined);
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => 'unused',
      now: () => '2026-11-13T00:00:00.000Z',
      retirePhoto,
    });
    await retention.finalize({ id: 'session', version: hiddenAgain });
    expect(retirePhoto).toHaveBeenCalledWith(sourceId);
    expect(await storage.retainedRequestSourceIds()).toEqual([]);
    const marker = await db.database.execute(
      'SELECT id FROM conversation_request_removed_sources WHERE id = ?',
      [sourceId],
    );
    expect(marker.rows).toHaveLength(1);
  } finally {
    db.close();
  }
});
