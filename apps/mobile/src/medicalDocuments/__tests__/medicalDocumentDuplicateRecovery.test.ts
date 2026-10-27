import type { RecordRepository, HashedSourceRecord } from '@orot/storage';
import { getProtectedMedicalDocumentSourceIds } from '../medicalDocumentNativeBridge';
import { trackStagedMedicalDocument } from '../medicalDocumentLifecycle';
import { createMedicalDocumentImportService } from '../medicalDocumentImportService';
import type {
  MedicalDocumentFileDeletion,
  StagedMedicalDocument,
} from '../medicalDocumentNativeBridge';

const stagedDocument: StagedMedicalDocument = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'synthetic-note.txt',
  contentHash: `sha256:${'a'.repeat(64)}`,
  sections: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      text: 'Synthetic medical note',
      startOffset: 0,
      endOffset: 22,
    },
  ],
};

const retainedSource: HashedSourceRecord = {
  id: '33333333-3333-4333-8333-333333333333',
  contentHash: stagedDocument.contentHash,
  ingestedAt: '2026-10-26T00:00:00.000Z',
  provenance: { origin: 'imported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  sourceKind: 'medical_document',
};

const incompatibleSource: HashedSourceRecord = {
  ...retainedSource,
  effectiveAt: '2026-10-25T00:00:00.000Z',
  recordedAt: '2026-10-25T00:00:00.000Z',
  id: '66666666-6666-4666-8666-666666666666',
  provenance: { origin: 'device_recorded', sourceRecordIds: [] },
  sourceKind: 'audio_recording',
};

/** Keeps database duplicate decisions separate from protected-file ownership. */
function setup(
  options: {
    lookups?: (HashedSourceRecord | null)[];
    transactionFailure?: Error;
  } = {},
) {
  trackStagedMedicalDocument(stagedDocument.id);
  const lookups = options.lookups ?? [];
  let lookupIndex = 0;
  const findByContentHash = jest.fn(async () => {
    const result = lookups[lookupIndex] ?? null;
    lookupIndex += 1;
    return result;
  });
  const transaction = options.transactionFailure
    ? jest.fn().mockRejectedValue(options.transactionFailure)
    : jest.fn().mockResolvedValue(undefined);
  const repository = {
    sourceRecords: { findByContentHash },
    transaction,
  } as unknown as RecordRepository;
  const files: jest.Mocked<MedicalDocumentFileDeletion> = {
    reconcile: jest.fn().mockResolvedValue(undefined),
    stage: jest.fn().mockResolvedValue(undefined),
    restore: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    ensureOriginal: jest.fn().mockResolvedValue(undefined),
    discard: jest.fn().mockResolvedValue(undefined),
  };
  const service = createMedicalDocumentImportService({
    loadRepository: async () => repository,
    fileDeletion: files,
  });
  return { files, service };
}

test('same-id retries keep the retained original', async () => {
  const { files, service } = setup({
    lookups: [{ ...retainedSource, id: stagedDocument.id }],
  });

  await expect(service.saveDocument(stagedDocument)).resolves.toBe('duplicate');

  expect(files.ensureOriginal).toHaveBeenCalledWith(
    stagedDocument.id,
    stagedDocument.id,
    stagedDocument.contentHash,
    expect.any(Number),
  );
  expect(files.discard).not.toHaveBeenCalled();
});

test('different-id duplicates restore a missing canonical original before cleanup', async () => {
  const { files, service } = setup({ lookups: [retainedSource] });
  const selectedDocument = {
    ...stagedDocument,
    id: '44444444-4444-4444-8444-444444444444',
  };
  trackStagedMedicalDocument(selectedDocument.id);

  await expect(service.saveDocument(selectedDocument)).resolves.toBe(
    'duplicate',
  );

  expect(files.ensureOriginal).toHaveBeenCalledWith(
    retainedSource.id,
    selectedDocument.id,
    selectedDocument.contentHash,
    expect.any(Number),
  );
  expect(files.discard).toHaveBeenCalledWith(selectedDocument.id);
  expect(files.ensureOriginal.mock.invocationCallOrder[0]).toBeLessThan(
    files.discard.mock.invocationCallOrder[0]!,
  );
  await expect(getProtectedMedicalDocumentSourceIds()).resolves.toContain(
    retainedSource.id,
  );
});

test('retains staged duplicate bytes when canonical recovery fails', async () => {
  const recoveryFailure = new Error('Synthetic original recovery failure.');
  const { files, service } = setup({ lookups: [retainedSource] });
  files.ensureOriginal.mockRejectedValue(recoveryFailure);

  await expect(service.saveDocument(stagedDocument)).rejects.toMatchObject({
    code: 'IMPORT_FAILED',
  });

  expect(files.discard).not.toHaveBeenCalled();
});

test('transaction-race duplicates use the same protected-original recovery', async () => {
  const selectedDocument = {
    ...stagedDocument,
    id: '55555555-5555-4555-8555-555555555555',
  };
  trackStagedMedicalDocument(selectedDocument.id);
  const { files, service } = setup({
    lookups: [null, retainedSource],
    transactionFailure: new Error('Synthetic unique-hash race.'),
  });

  await expect(service.saveDocument(selectedDocument)).resolves.toBe(
    'duplicate',
  );

  expect(files.ensureOriginal).toHaveBeenCalledWith(
    retainedSource.id,
    selectedDocument.id,
    selectedDocument.contentHash,
    expect.any(Number),
  );
  expect(files.discard).toHaveBeenCalledWith(selectedDocument.id);
  expect(files.ensureOriginal.mock.invocationCallOrder[0]).toBeLessThan(
    files.discard.mock.invocationCallOrder[0]!,
  );
});

test('matching hashes on another source kind are not treated as document duplicates', async () => {
  const { files, service } = setup({ lookups: [incompatibleSource] });

  await expect(service.saveDocument(stagedDocument)).rejects.toMatchObject({
    code: 'IMPORT_FAILED',
  });

  expect(files.ensureOriginal).not.toHaveBeenCalled();
  expect(files.discard).not.toHaveBeenCalled();
});

test('transaction-race hash collisions with another source kind remain failed imports', async () => {
  const { files, service } = setup({
    lookups: [null, incompatibleSource],
    transactionFailure: new Error('Synthetic unique-hash collision.'),
  });

  await expect(service.saveDocument(stagedDocument)).rejects.toMatchObject({
    code: 'IMPORT_FAILED',
  });

  expect(files.ensureOriginal).not.toHaveBeenCalled();
  expect(files.discard).not.toHaveBeenCalled();
});
