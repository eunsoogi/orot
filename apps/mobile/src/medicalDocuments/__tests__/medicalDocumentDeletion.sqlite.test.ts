import { openEncryptedStorage } from '@orot/storage';
import {
  createDatabase,
  options,
  sourceRecord,
  evidenceSpan,
  hashA,
  hashB,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { createMedicalDocumentDeletion } from '../medicalDocumentDeletion';

/** Real SQLite proves per-source cascading/isolation; native files and memory are separate adapter tests. */
test('deletes one imported document and its excerpts without deleting another source', async () => {
  const database = createDatabase();
  try {
    const repository = await openEncryptedStorage(options(database));
    const selected = await repository.sourceRecords.create({
      ...sourceRecord('selected', hashA),
      sourceKind: 'medical_document',
    });
    const unrelated = await repository.sourceRecords.create({
      ...sourceRecord('unrelated', hashB),
      sourceKind: 'medical_document',
    });
    const locator = {
      kind: 'text_range' as const,
      startOffset: 0,
      endOffset: 10,
    };
    await repository.evidenceSpans.create(
      evidenceSpan('selected-span', selected.id, locator),
    );
    await repository.evidenceSpans.create(
      evidenceSpan('unrelated-span', unrelated.id, locator),
    );
    const remove = createMedicalDocumentDeletion({
      repository: async () => repository,
      removeSource: async id => ({
        sourceDeleted: await repository.sourceRecords.delete(id),
      }),
      files: {
        stage: jest.fn(),
        restore: jest.fn(),
        commit: jest.fn(),
        reconcile: jest.fn(),
        ensureOriginal: jest.fn(),
        discard: jest.fn(),
      },
    });
    await remove(selected.id);
    expect(await repository.sourceRecords.get(selected.id)).toBeNull();
    expect(await repository.evidenceSpans.get('selected-span')).toBeNull();
    expect(await repository.sourceRecords.get(unrelated.id)).toEqual(unrelated);
    expect(await repository.evidenceSpans.get('unrelated-span')).not.toBeNull();
    expect(
      await repository.listDeletedSourceReferenceIds([
        selected.id,
        'selected-span',
        unrelated.id,
      ]),
    ).toEqual(expect.arrayContaining([selected.id, 'selected-span']));
  } finally {
    await database.closeAsync?.();
  }
});
