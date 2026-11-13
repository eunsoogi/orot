import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createMedicalDocumentImportService } from '../../medicalDocuments/medicalDocumentImportService';
import { discardMedicalDocumentFromLifecycle } from '../../medicalDocuments/medicalDocumentLifecycle';
import { createConversationPhotoImport } from '../conversationPhotoImport';

test('selection and removal leave the real source-record database unchanged', async () => {
  const fixture = await healthContextFixture();
  const document = {
    id: 'synthetic-photo',
    displayName: 'synthetic.jpg',
    contentHash: `sha256:${'a'.repeat(64)}` as const,
    sections: [
      {
        id: 'synthetic-span',
        text: 'synthetic text',
        startOffset: 0,
        endOffset: 14,
      },
    ],
  };
  const files = {
    reconcile: jest.fn().mockResolvedValue(undefined),
    discard: jest.fn().mockResolvedValue(undefined),
    stage: jest.fn(),
    restore: jest.fn(),
    commit: jest.fn(),
    ensureOriginal: jest.fn(),
  };
  try {
    const before = await fixture.repository.list('source_record');
    const evidenceBefore = await fixture.repository.list('evidence_span');
    const service = createMedicalDocumentImportService({
      retainedConversationSourceIds: async () => [],
      loadRepository: async () => fixture.repository,
      fileDeletion: files,
      pick: jest.fn().mockResolvedValue(document),
    });
    const drafts = createConversationPhotoImport(service);
    await drafts.select(1);
    expect(drafts.get(1)).toMatchObject({ status: 'ready', photo: document });
    expect(await fixture.repository.list('source_record')).toEqual(before);
    expect(await fixture.repository.list('evidence_span')).toEqual(
      evidenceBefore,
    );
    await drafts.remove(1);
    expect(files.discard).toHaveBeenCalledWith(document.id);
    expect(await fixture.repository.list('source_record')).toEqual(before);
    expect(await fixture.repository.list('evidence_span')).toEqual(
      evidenceBefore,
    );
  } finally {
    discardMedicalDocumentFromLifecycle(document.id);
    fixture.close();
  }
});
