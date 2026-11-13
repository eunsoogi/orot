import { createConversationPhotoImport } from '../conversationPhotoImport';
import {
  currentMedicalDocumentGeneration,
  startMedicalDocumentDeletion,
  endMedicalDocumentDeletion,
  discardMedicalDocumentFromLifecycle,
} from '../../medicalDocuments/medicalDocumentLifecycle';

test('request handoff retains an independent OCR snapshot with the same protected source identity', async () => {
  const section = {
    id: 'span',
    text: 'synthetic original',
    startOffset: 0,
    endOffset: 18,
  };
  const document = {
    id: 'source',
    displayName: 'synthetic.jpg',
    contentHash: `sha256:${'a'.repeat(64)}` as const,
    sections: [section],
  };
  const drafts = createConversationPhotoImport({
    selectDocument: async () => document,
    discardDocument: async () => {},
  });
  await drafts.select(1);
  const lease = drafts.beginHandoff(1, {
    sessionId: 'session',
    sessionVersion: 0,
    requestId: 'request',
    inputRevision: 1,
  })!;
  section.text = 'changed';
  expect(lease.photo.id).toBe('source');
  expect(lease.photo.sections[0]?.text).toBe('synthetic original');
  await lease.rollback();
  await drafts.clear();
});

test('handoff retains the selection deletion generation even when deletion starts during publication', async () => {
  const document = {
    id: 'source-generation',
    displayName: 'synthetic.jpg',
    contentHash: `sha256:${'a'.repeat(64)}` as const,
    sections: [{ id: 'span', text: 'synthetic', startOffset: 0, endOffset: 9 }],
  };
  const drafts = createConversationPhotoImport({
    selectDocument: async () => document,
    discardDocument: async () => {},
  });
  try {
    await drafts.select(1);
    const generation = currentMedicalDocumentGeneration();
    drafts.subscribe(() => {
      if (drafts.get(1).status === 'transferring') {
        startMedicalDocumentDeletion();
        endMedicalDocumentDeletion();
      }
    });
    const lease = drafts.beginHandoff(1, {
      sessionId: 'session',
      sessionVersion: 0,
      requestId: 'request',
      inputRevision: 1,
    })!;
    expect(lease.stagingGeneration).toBe(generation);
    const committed = lease.commit();
    if (!committed || !committed.removed)
      throw new Error('Expected invalid source retirement.');
    committed.acknowledgeRemoval({ ok: true });
  } finally {
    discardMedicalDocumentFromLifecycle(document.id);
  }
});
