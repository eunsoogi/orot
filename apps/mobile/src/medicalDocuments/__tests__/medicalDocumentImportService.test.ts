import type { EvidenceSpan, SourceRecord } from '@orot/domain';
import { chunkEvidenceSpan } from '@orot/rag';
import type {
  HashedSourceRecord,
  RecordRepository,
  RecordWriter,
} from '@orot/storage';
import {
  createMedicalDocumentImportService,
  type MedicalDocumentImportDependencies,
} from '../medicalDocumentImportService';
import type {
  MedicalDocumentFileDeletion,
  StagedMedicalDocument,
} from '../medicalDocumentNativeBridge';

const document: StagedMedicalDocument = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'synthetic-visit-note.pdf',
  contentHash: `sha256:${'a'.repeat(64)}`,
  sections: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      text: 'Synthetic excerpt 🌱',
      pageNumber: 2,
      startOffset: 0,
      endOffset: 'Synthetic excerpt 🌱'.length,
    },
  ],
};

function setup(overrides: Partial<MedicalDocumentImportDependencies> = {}) {
  const writes: Array<{ kind: string; record: unknown }> = [];
  const writer = {
    get: jest.fn().mockResolvedValue(null),
    put: jest.fn(async (kind: string, record: unknown) => {
      writes.push({ kind, record });
    }),
  } as unknown as RecordWriter;
  const repository = {
    list: jest.fn().mockResolvedValue([
      { id: document.id, sourceKind: 'medical_document' },
      {
        id: '33333333-3333-4333-8333-333333333333',
        sourceKind: 'audio_recording',
      },
    ]),
    sourceRecords: {
      get: jest.fn().mockResolvedValue(null),
      findByContentHash: jest.fn().mockResolvedValue(null),
    },
    evidenceSpans: {
      listForSourceRecord: jest.fn().mockResolvedValue([]),
    },
    transaction: jest.fn(
      async (operation: (writer: RecordWriter) => Promise<unknown>) =>
        operation(writer),
    ),
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
    pick: jest.fn().mockResolvedValue(document),
    now: () => '2026-10-01T10:00:00.000Z',
    ...overrides,
  });
  return { files, repository, service, writes };
}

test('reconciles saved document files before opening the picker', async () => {
  const { files, repository, service } = setup();

  await expect(service.selectDocument()).resolves.toEqual(document);

  expect(repository.list).toHaveBeenCalledWith('source_record');
  expect(files.reconcile).toHaveBeenCalledWith([document.id]);
});

test('stores unreviewed provenance and page locators without inventing clinical dates', async () => {
  const { service, writes } = setup();

  await expect(service.saveDocument(document)).resolves.toBe('saved');

  const source = writes.find(write => write.kind === 'source_record')
    ?.record as SourceRecord;
  const span = writes.find(write => write.kind === 'evidence_span')
    ?.record as EvidenceSpan;
  expect(source).toMatchObject({
    id: document.id,
    sourceKind: 'medical_document',
    contentHash: document.contentHash,
    ingestedAt: '2026-10-01T10:00:00.000Z',
    provenance: { origin: 'imported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
  });
  expect(source.effectiveAt).toBeUndefined();
  expect(source.recordedAt).toBeUndefined();
  expect(span).toMatchObject({
    id: document.sections[0]!.id,
    sourceRecordId: document.id,
    text: document.sections[0]!.text,
    ingestedAt: '2026-10-01T10:00:00.000Z',
    provenance: { origin: 'imported', sourceRecordIds: [document.id] },
    reviewState: { status: 'unreviewed' },
    pageNumber: 2,
    locator: {
      kind: 'document_range',
      pageNumber: 2,
      startOffset: 0,
      endOffset: document.sections[0]!.text.length,
    },
  });
  expect(span.effectiveAt).toBeUndefined();
  expect(span.recordedAt).toBeUndefined();
  expect(chunkEvidenceSpan(span).metadata.effectiveTime).toBeNull();
});

test('does not create a second source row for the same document bytes', async () => {
  const { files, repository, service, writes } = setup();
  jest.mocked(repository.sourceRecords.findByContentHash).mockResolvedValue({
    id: '44444444-4444-4444-8444-444444444444',
    contentHash: document.contentHash,
    ingestedAt: '2026-10-01T10:00:00.000Z',
    provenance: { origin: 'imported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    sourceKind: 'medical_document',
  } as HashedSourceRecord);

  await expect(service.saveDocument(document)).resolves.toBe('duplicate');

  expect(files.discard).toHaveBeenCalledWith(document.id);
  expect(repository.transaction).not.toHaveBeenCalled();
  expect(writes).toHaveLength(0);
});

test('keeps the staged original available when record persistence can be retried', async () => {
  const { files, repository, service } = setup();
  const persistenceFailure = new Error('Synthetic storage interruption.');
  jest.mocked(repository.transaction).mockRejectedValueOnce(persistenceFailure);

  await expect(service.saveDocument(document)).rejects.toBe(persistenceFailure);

  expect(files.discard).not.toHaveBeenCalled();
});

test('lists saved medical documents newest first without exposing other source kinds', async () => {
  const { repository, service } = setup();
  const older = {
    id: '44444444-4444-4444-8444-444444444444',
    sourceKind: 'medical_document',
    title: 'Older synthetic note',
    ingestedAt: '2026-09-01T10:00:00.000Z',
    provenance: { origin: 'imported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
  };
  const newer = {
    ...older,
    id: '55555555-5555-4555-8555-555555555555',
    title: 'Newer synthetic note',
    ingestedAt: '2026-10-01T10:00:00.000Z',
  };
  jest.mocked(repository.list).mockResolvedValue([
    older,
    {
      id: '66666666-6666-4666-8666-666666666666',
      sourceKind: 'audio_recording',
    },
    newer,
  ] as never);

  await expect(service.listDocuments()).resolves.toEqual([newer, older]);
  expect(repository.list).toHaveBeenCalledWith('source_record');
});

test('loads a saved document with its page and text evidence locators', async () => {
  const { repository, service } = setup();
  const source = {
    id: '77777777-7777-4777-8777-777777777777',
    sourceKind: 'medical_document',
    title: 'Synthetic located note',
    ingestedAt: '2026-10-01T10:00:00.000Z',
    provenance: { origin: 'imported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
  };
  const first = {
    id: '99999999-9999-4999-8999-999999999999',
    sourceRecordId: source.id,
    text: 'Second page excerpt',
    pageNumber: 2,
    ingestedAt: source.ingestedAt,
    provenance: { origin: 'imported', sourceRecordIds: [source.id] },
    reviewState: { status: 'unreviewed' },
    locator: {
      kind: 'document_range',
      pageNumber: 2,
      startOffset: 0,
      endOffset: 20,
    },
  };
  const second = {
    ...first,
    id: '88888888-8888-4888-8888-888888888888',
    text: 'First page excerpt',
    pageNumber: 1,
    locator: {
      kind: 'document_range',
      pageNumber: 1,
      startOffset: 0,
      endOffset: 18,
    },
  };
  jest.mocked(repository.sourceRecords.get).mockResolvedValue(source as never);
  jest
    .mocked(repository.evidenceSpans.listForSourceRecord)
    .mockResolvedValue([first, second] as never);

  await expect(service.getDocument(source.id)).resolves.toEqual({
    ...source,
    evidenceSpans: [second, first],
  });
  expect(repository.evidenceSpans.listForSourceRecord).toHaveBeenCalledWith(
    source.id,
  );
});

test('does not open a non-medical source as an imported document', async () => {
  const { repository, service } = setup();
  jest.mocked(repository.sourceRecords.get).mockResolvedValue({
    id: document.id,
    sourceKind: 'audio_recording',
  } as never);

  await expect(service.getDocument(document.id)).resolves.toBeNull();
  expect(repository.evidenceSpans.listForSourceRecord).not.toHaveBeenCalled();
});
