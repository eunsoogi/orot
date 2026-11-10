import { openEncryptedStorage } from '../src';
import { createMedicalDocumentImportService } from '../../../apps/mobile/src/medicalDocuments/medicalDocumentImportService';
import { trackStagedMedicalDocument } from '../../../apps/mobile/src/medicalDocuments/medicalDocumentLifecycle';
import { createDatabase, options } from './sourceEvidenceTestSupport';

jest.mock('react-native', () => ({ NativeModules: {} }));

const document = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Synthetic photo.jpg',
  contentHash: `sha256:${'a'.repeat(64)}` as const,
  sections: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      text: 'Synthetic photo text',
      startOffset: 0,
      endOffset: 20,
    },
  ],
};

test('rolls back photo evidence failure and safely retries and deduplicates in SQLite', async () => {
  const database = createDatabase();
  const repository = await openEncryptedStorage(options(database));
  const files = {
    reconcile: jest.fn(),
    stage: jest.fn(),
    restore: jest.fn(),
    commit: jest.fn(),
    ensureOriginal: jest.fn(),
    discard: jest.fn(),
  };
  const service = createMedicalDocumentImportService({
    loadRepository: async () => repository,
    fileDeletion: files,
    now: () => '2026-11-01T00:00:00.000Z',
  });
  trackStagedMedicalDocument(document.id);
  try {
    // A database trigger fails after the source write, exercising the real rollback boundary.
    await database.execute(
      "CREATE TRIGGER fail_photo_evidence BEFORE INSERT ON evidence_spans BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    );
    await expect(service.saveDocument(document)).rejects.toThrow();
    expect(await repository.sourceRecords.get(document.id)).toBeNull();
    expect(await repository.evidenceSpans.listForSourceRecord(document.id)).toEqual([]);
    expect(files.discard).not.toHaveBeenCalled();
    await database.execute('DROP TRIGGER fail_photo_evidence');
    await expect(service.saveDocument(document)).resolves.toBe('saved');
    expect(await repository.sourceRecords.get(document.id)).toMatchObject({ id: document.id });
    expect(await repository.evidenceSpans.listForSourceRecord(document.id)).toHaveLength(1);
    await expect(service.saveDocument(document)).resolves.toBe('duplicate');
    expect(await repository.list('source_record')).toHaveLength(1);
    expect(await repository.evidenceSpans.listForSourceRecord(document.id)).toHaveLength(1);
    await service.discardDocument(document);
    expect(files.discard).not.toHaveBeenCalled();
  } finally {
    await database.closeAsync?.();
  }
});
