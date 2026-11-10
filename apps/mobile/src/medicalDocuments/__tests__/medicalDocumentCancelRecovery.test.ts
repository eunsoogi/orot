import type { RecordRepository } from '@orot/storage';
import { createMedicalDocumentImportService } from '../medicalDocumentImportService';
import { trackStagedMedicalDocument } from '../medicalDocumentLifecycle';
import type {
  MedicalDocumentFileDeletion,
  StagedMedicalDocument,
} from '../medicalDocumentNativeBridge';

const document: StagedMedicalDocument = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'synthetic.png',
  contentHash: `sha256:${'a'.repeat(64)}`,
  sections: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      text: 'Test',
      startOffset: 0,
      endOffset: 4,
    },
  ],
};

function files(): jest.Mocked<MedicalDocumentFileDeletion> {
  return {
    reconcile: jest.fn(),
    stage: jest.fn(),
    restore: jest.fn(),
    commit: jest.fn(),
    ensureOriginal: jest.fn(),
    discard: jest.fn().mockResolvedValue(undefined),
  };
}

test('allows cancellation after database open fails before any transaction', async () => {
  const originals = files();
  const service = createMedicalDocumentImportService({
    loadRepository: jest
      .fn()
      .mockRejectedValue(new Error('synthetic unavailable')),
    fileDeletion: originals,
  });
  trackStagedMedicalDocument(document.id);
  await expect(service.saveDocument(document)).rejects.toMatchObject({
    code: 'SAVE_FAILED',
  });
  await expect(service.discardDocument(document)).resolves.toBeUndefined();
  expect(originals.discard).toHaveBeenCalledWith(document.id);
});

test('retains an original when transaction outcome and database read are both unavailable', async () => {
  const originals = files();
  const repository = {
    sourceRecords: {
      findByContentHash: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockRejectedValue(new Error('synthetic unavailable')),
      get: jest.fn().mockRejectedValue(new Error('synthetic unavailable')),
    },
    transaction: jest
      .fn()
      .mockRejectedValue(new Error('synthetic uncertain commit')),
  } as unknown as RecordRepository;
  const service = createMedicalDocumentImportService({
    loadRepository: async () => repository,
    fileDeletion: originals,
  });
  trackStagedMedicalDocument(document.id);
  await expect(service.saveDocument(document)).rejects.toMatchObject({
    code: 'SAVE_FAILED',
  });
  await expect(service.discardDocument(document)).rejects.toMatchObject({
    code: 'CLEANUP_FAILED',
  });
  expect(originals.discard).not.toHaveBeenCalled();
});
