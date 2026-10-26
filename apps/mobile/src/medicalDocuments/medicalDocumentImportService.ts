import type { EvidenceSpan, SourceRecord } from '@orot/domain';
import type { RecordRepository } from '@orot/storage';
import {
  MedicalDocumentImportError,
  medicalDocumentFileDeletion,
  medicalDocumentNativeBridge,
} from './medicalDocumentNativeBridge';
import type {
  MedicalDocumentFileDeletion,
  StagedMedicalDocument,
} from './medicalDocumentNativeBridge';

export type MedicalDocumentSaveResult = 'saved' | 'duplicate';
export type MedicalDocumentSourceRecord = Extract<
  SourceRecord,
  { sourceKind: 'medical_document' }
>;

export interface SavedMedicalDocument extends MedicalDocumentSourceRecord {
  readonly evidenceSpans: readonly EvidenceSpan[];
}

export interface MedicalDocumentImportService {
  listDocuments(): Promise<MedicalDocumentSourceRecord[]>;
  getDocument(sourceId: string): Promise<SavedMedicalDocument | null>;
  selectDocument(): Promise<StagedMedicalDocument | null>;
  saveDocument(
    document: StagedMedicalDocument,
  ): Promise<MedicalDocumentSaveResult>;
  discardDocument(document: StagedMedicalDocument): Promise<void>;
}

export interface MedicalDocumentImportDependencies {
  readonly loadRepository?: () => Promise<RecordRepository>;
  readonly fileDeletion?: MedicalDocumentFileDeletion;
  readonly pick?: typeof medicalDocumentNativeBridge.pick;
  readonly now?: () => string;
}

async function loadRepository(): Promise<RecordRepository> {
  const { openLocalStorage } = await import('../storage/secureDatabase');
  return openLocalStorage();
}

function makeSourceRecord(
  document: StagedMedicalDocument,
  timestamp: string,
): SourceRecord {
  // The import time belongs to provenance; it must not masquerade as the clinical event date.
  return {
    id: document.id,
    ingestedAt: timestamp,
    provenance: { origin: 'imported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    sourceKind: 'medical_document',
    title: document.displayName,
    contentHash: document.contentHash,
  };
}

function makeEvidenceSpans(
  document: StagedMedicalDocument,
  timestamp: string,
): EvidenceSpan[] {
  return document.sections.map(section => ({
    id: section.id,
    ingestedAt: timestamp,
    provenance: { origin: 'imported', sourceRecordIds: [document.id] },
    reviewState: { status: 'unreviewed' },
    sourceRecordId: document.id,
    text: section.text,
    ...(section.pageNumber === undefined
      ? {}
      : { pageNumber: section.pageNumber }),
    locator:
      section.pageNumber === undefined
        ? {
            kind: 'text_range' as const,
            startOffset: section.startOffset,
            endOffset: section.endOffset,
          }
        : {
            kind: 'document_range' as const,
            pageNumber: section.pageNumber,
            startOffset: section.startOffset,
            endOffset: section.endOffset,
          },
  }));
}

function compareEvidenceSpans(left: EvidenceSpan, right: EvidenceSpan): number {
  const leftPage = left.pageNumber ?? 0;
  const rightPage = right.pageNumber ?? 0;
  const byPage = leftPage - rightPage;
  if (byPage !== 0) return byPage;

  const leftOffset =
    left.locator?.kind === 'text_range' ||
    left.locator?.kind === 'document_range'
      ? left.locator.startOffset
      : 0;
  const rightOffset =
    right.locator?.kind === 'text_range' ||
    right.locator?.kind === 'document_range'
      ? right.locator.startOffset
      : 0;
  return leftOffset - rightOffset || left.id.localeCompare(right.id);
}

/** Commits source and excerpt rows together, while native cleanup owns any uncommitted original. */
export function createMedicalDocumentImportService(
  dependencies: MedicalDocumentImportDependencies = {},
): MedicalDocumentImportService {
  const getRepository = dependencies.loadRepository ?? loadRepository;
  const files = dependencies.fileDeletion ?? medicalDocumentFileDeletion;
  const pick = dependencies.pick ?? medicalDocumentNativeBridge.pick;
  const getTimestamp = dependencies.now ?? (() => new Date().toISOString());

  return {
    async listDocuments() {
      const repository = await getRepository();
      return (await repository.list('source_record'))
        .filter(
          (source): source is MedicalDocumentSourceRecord =>
            source.sourceKind === 'medical_document',
        )
        .sort(
          (left, right) =>
            right.ingestedAt.localeCompare(left.ingestedAt) ||
            left.id.localeCompare(right.id),
        );
    },
    async getDocument(sourceId) {
      const repository = await getRepository();
      const source = await repository.sourceRecords.get(sourceId);
      if (!source || source.sourceKind !== 'medical_document') return null;
      const evidenceSpans =
        await repository.evidenceSpans.listForSourceRecord(sourceId);
      // The repository orders by identity; this view restores source page/offset order.
      evidenceSpans.sort(compareEvidenceSpans);
      return { ...source, evidenceSpans };
    },
    async selectDocument() {
      const repository = await getRepository();
      const sources = await repository.list('source_record');
      const documentIds = sources
        .filter(source => source.sourceKind === 'medical_document')
        .map(source => source.id);
      await files.reconcile(documentIds);
      return pick();
    },
    async saveDocument(document) {
      const repository = await getRepository();
      const existing = await repository.sourceRecords.findByContentHash(
        document.contentHash,
      );
      if (existing) {
        await discardOriginal(files, document.id);
        return 'duplicate';
      }

      const timestamp = getTimestamp();
      const source = makeSourceRecord(document, timestamp);
      const spans = makeEvidenceSpans(document, timestamp);
      if (spans.length === 0) {
        throw new MedicalDocumentImportError('EMPTY_DOCUMENT');
      }

      try {
        await repository.transaction(async writer => {
          if (await writer.get('source_record', document.id)) {
            throw new Error('The document source identifier already exists.');
          }
          await writer.put('source_record', source);
          for (const span of spans) await writer.put('evidence_span', span);
        });
        return 'saved';
      } catch (error) {
        let duplicate: SourceRecord | null;
        try {
          duplicate = await repository.sourceRecords.findByContentHash(
            document.contentHash,
          );
        } catch {
          throw error;
        }
        if (duplicate) {
          await discardOriginal(files, document.id);
          return 'duplicate';
        }
        // Keep the staged original available so the review can retry or cancel this save.
        throw error;
      }
    },
    async discardDocument(document) {
      await discardOriginal(files, document.id);
    },
  };
}

async function discardOriginal(
  files: MedicalDocumentFileDeletion,
  sourceId: string,
): Promise<void> {
  try {
    await files.discard(sourceId);
  } catch {
    throw new MedicalDocumentImportError('CLEANUP_FAILED');
  }
}

export const medicalDocumentImportService =
  createMedicalDocumentImportService();
