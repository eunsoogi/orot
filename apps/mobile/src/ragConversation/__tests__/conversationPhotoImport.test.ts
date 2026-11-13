import { createConversationPhotoImport } from '../conversationPhotoImport';
import { MedicalDocumentImportError } from '../../medicalDocuments/medicalDocumentNativeBridge';
import {
  startMedicalDocumentDeletion,
  endMedicalDocumentDeletion,
} from '../../medicalDocuments/medicalDocumentLifecycle';

test('uses the selected-photo import path and discards an uncommitted original', async () => {
  const document = {
    id: 'synthetic-photo',
    displayName: 'synthetic.jpg',
    contentHash: 'sha256:synthetic' as const,
    sections: [],
  };
  const service = {
    selectDocument: jest.fn().mockResolvedValue(document),
    discardDocument: jest.fn().mockResolvedValue(undefined),
  };
  const photos = createConversationPhotoImport(service);
  await photos.select(7);
  expect(service.selectDocument).toHaveBeenCalledWith('photos');
  expect(photos.get(7)).toEqual({ status: 'ready', photo: document });
  await photos.remove(7);
  expect(service.discardDocument).toHaveBeenCalledWith(document);
});

test('a photo returned after local-data deletion is discarded instead of entering the draft', async () => {
  let resolve!: (document: {
    id: string;
    displayName: string;
    contentHash: `sha256:${string}`;
    sections: [];
  }) => void;
  const picked = new Promise<{
    id: string;
    displayName: string;
    contentHash: `sha256:${string}`;
    sections: [];
  }>(done => {
    resolve = done;
  });
  const service = {
    selectDocument: jest.fn().mockReturnValue(picked),
    discardDocument: jest.fn().mockResolvedValue(undefined),
  };
  const photos = createConversationPhotoImport(service);
  const pending = photos.select(1);
  startMedicalDocumentDeletion();
  endMedicalDocumentDeletion();
  const document = {
    id: 'stale',
    displayName: 'synthetic.jpg',
    contentHash: 'sha256:synthetic' as const,
    sections: [] as [],
  };
  resolve(document);
  await pending;
  expect(service.discardDocument).toHaveBeenCalledWith(document);
  expect(photos.get(1).status).toBe('error');
});

test('a stale picker result remains owned when protected-file cleanup fails', async () => {
  let resolve!: (value: {
    id: string;
    displayName: string;
    contentHash: `sha256:${string}`;
    sections: [];
  }) => void;
  const selected = new Promise<{
    id: string;
    displayName: string;
    contentHash: `sha256:${string}`;
    sections: [];
  }>(done => {
    resolve = done;
  });
  const discardDocument = jest
    .fn()
    .mockRejectedValueOnce(new Error('cleanup'))
    .mockResolvedValueOnce(undefined);
  const photos = createConversationPhotoImport({
    selectDocument: () => selected,
    discardDocument,
  });
  const pending = photos.select(1);
  startMedicalDocumentDeletion();
  endMedicalDocumentDeletion();
  resolve({
    id: 'stale',
    displayName: 'synthetic.jpg',
    contentHash: 'sha256:synthetic',
    sections: [],
  });
  await expect(pending).rejects.toThrow('cleanup');
  expect(photos.get(1).status).toBe('error');
  expect(photos.cleanupPending(1)).toBe(true);
  await photos.retryCleanup(1);
  expect(photos.cleanupPending(1)).toBe(false);
});

test('deletion during replacement retires both originals even if one cleanup fails', async () => {
  const old = {
    id: 'old',
    displayName: 'old.jpg',
    contentHash: 'sha256:old' as const,
    sections: [] as [],
  };
  const next = {
    id: 'next',
    displayName: 'next.jpg',
    contentHash: 'sha256:next' as const,
    sections: [] as [],
  };
  let finish!: (value: typeof next) => void;
  const picked = new Promise<typeof next>(resolve => {
    finish = resolve;
  });
  const selectDocument = jest
    .fn()
    .mockResolvedValueOnce(old)
    .mockReturnValueOnce(picked);
  const discardDocument = jest
    .fn()
    .mockImplementation(async (document: { id: string }) => {
      if (document.id === 'next') throw new Error('cleanup');
    });
  const photos = createConversationPhotoImport({
    selectDocument,
    discardDocument,
  });
  await photos.select(1);
  const replacing = photos.select(1);
  startMedicalDocumentDeletion();
  endMedicalDocumentDeletion();
  finish(next);
  await expect(replacing).rejects.toThrow('cleanup');
  expect(discardDocument).toHaveBeenCalledWith(old);
  expect(discardDocument).toHaveBeenCalledWith(next);
  expect(photos.get(1)).toEqual({ status: 'error' });
  expect(photos.cleanupPending(1)).toBe(true);
});

test('unsupported image and missing OCR text retain distinct actionable failure reasons', async () => {
  const selectDocument = jest
    .fn()
    .mockRejectedValueOnce(
      new MedicalDocumentImportError('UNSUPPORTED_DOCUMENT'),
    )
    .mockRejectedValueOnce(new MedicalDocumentImportError('EMPTY_DOCUMENT'));
  const photos = createConversationPhotoImport({
    selectDocument,
    discardDocument: async () => {},
  });
  await photos.select(1);
  expect(photos.get(1)).toMatchObject({
    status: 'error',
    reason: 'unsupported',
  });
  await photos.select(1);
  expect(photos.get(1)).toMatchObject({ status: 'error', reason: 'empty' });
});

test('subscribers can observe a cleanup failure and its successful retry', async () => {
  let finish!: (value: {
    id: string;
    displayName: string;
    contentHash: `sha256:${string}`;
    sections: [];
  }) => void;
  const picked = new Promise<{
    id: string;
    displayName: string;
    contentHash: `sha256:${string}`;
    sections: [];
  }>(resolve => {
    finish = resolve;
  });
  const discardDocument = jest
    .fn()
    .mockRejectedValueOnce(new Error('locked'))
    .mockResolvedValueOnce(undefined);
  const photos = createConversationPhotoImport({
    selectDocument: () => picked,
    discardDocument,
  });
  const updates: boolean[] = [];
  photos.subscribe(() => updates.push(photos.cleanupPending(1)));
  const selection = photos.select(1);
  await photos.remove(1);
  finish({
    id: 'stale',
    displayName: 'synthetic.jpg',
    contentHash: 'sha256:synthetic',
    sections: [],
  });
  await expect(selection).rejects.toThrow('locked');
  expect(photos.failedCleanupSessionIds()).toEqual([1]);
  await photos.retryCleanup(1);
  expect(photos.failedCleanupSessionIds()).toEqual([]);
  expect(updates).toContain(true);
  expect(updates.at(-1)).toBe(false);
});

test('picker activity is observable across sessions and clears after cancellation', async () => {
  let finish!: (value: null) => void;
  const pending = new Promise<null>(resolve => {
    finish = resolve;
  });
  const photos = createConversationPhotoImport({
    selectDocument: () => pending,
    discardDocument: async () => {},
  });
  const updates: boolean[] = [];
  photos.subscribe(() => updates.push(photos.isPicking()));
  const selection = photos.select(1);
  expect(photos.isPicking()).toBe(true);
  finish(null);
  await selection;
  expect(updates).toContain(true);
  expect(updates.at(-1)).toBe(false);
});

test('a failed view listener cannot interrupt cleanup after local data is cleared', async () => {
  const document = {
    id: 'synthetic',
    displayName: 'synthetic.jpg',
    contentHash: 'sha256:synthetic' as const,
    sections: [] as [],
  };
  const discardDocument = jest.fn().mockResolvedValue(undefined);
  const photos = createConversationPhotoImport({
    selectDocument: async () => document,
    discardDocument,
  });
  await photos.select(1);
  photos.subscribe(() => {
    throw new Error('view unavailable');
  });
  await photos.clear();
  expect(photos.get(1).status).toBe('empty');
  expect(discardDocument).toHaveBeenCalledWith(document);
});
