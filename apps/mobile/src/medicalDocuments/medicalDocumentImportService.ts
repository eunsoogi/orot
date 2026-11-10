import type { EvidenceSpan, SourceRecord } from '@orot/domain';
import type { RecordRepository } from '@orot/storage';
import {
  MedicalDocumentImportError,
  medicalDocumentFileDeletion,
  medicalDocumentNativeBridge,
  markMedicalDocumentPersisted,
} from './medicalDocumentNativeBridge';
import type {
  MedicalDocumentFileDeletion,
  StagedMedicalDocument,
} from './medicalDocumentNativeBridge';
import {
  canUseMedicalDocumentGeneration,
  currentMedicalDocumentGeneration,
  getMedicalDocumentGeneration,
  trackStagedMedicalDocument,
} from './medicalDocumentLifecycle';
import {
  compareMedicalDocumentEvidenceSpans,
  makeMedicalDocumentEvidenceSpans,
  makeMedicalDocumentSourceRecord,
} from './medicalDocumentImportRecords';
import {
  discardOriginal,
  preserveDuplicateOriginal,
  saveFailure,
} from './medicalDocumentSaveRecovery';

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
  selectDocument(
    source?: 'files' | 'photos',
  ): Promise<StagedMedicalDocument | null>;
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

/** Commits source and excerpt rows together, while native cleanup owns any uncommitted original. */
export function createMedicalDocumentImportService(
  dependencies: MedicalDocumentImportDependencies = {},
): MedicalDocumentImportService {
  const getRepository = dependencies.loadRepository ?? loadRepository;
  const files = dependencies.fileDeletion ?? medicalDocumentFileDeletion;
  const pick = dependencies.pick ?? medicalDocumentNativeBridge.pick;
  const getTimestamp = dependencies.now ?? (() => new Date().toISOString());
  // Only a transaction attempt or an already-persisted identity can make cancellation ambiguous.
  const possiblyCommitted = new Set<string>();

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
      evidenceSpans.sort(compareMedicalDocumentEvidenceSpans);
      return { ...source, evidenceSpans };
    },
    async selectDocument(selectionSource = 'files') {
      // Bind the database snapshot and picker call to one lifecycle epoch.
      const generation = currentMedicalDocumentGeneration();
      if (!canUseMedicalDocumentGeneration(generation)) {
        throw new MedicalDocumentImportError('IMPORT_FAILED');
      }
      const repository = await getRepository();
      const sources = await repository.list('source_record');
      const documentIds = sources
        .filter(source => source.sourceKind === 'medical_document')
        .map(source => source.id);
      await files.reconcile(documentIds, generation);
      if (!canUseMedicalDocumentGeneration(generation)) {
        throw new MedicalDocumentImportError('IMPORT_FAILED');
      }
      const document = await pick(selectionSource);
      if (dependencies.pick !== undefined && document) {
        if (!canUseMedicalDocumentGeneration(generation)) {
          throw new MedicalDocumentImportError('IMPORT_FAILED');
        }
        trackStagedMedicalDocument(document.id);
      }
      return document;
    },
    async saveDocument(document) {
      // A retired picker ID has no current generation and cannot be saved again.
      const generation = getMedicalDocumentGeneration(document.id);
      if (
        generation === undefined ||
        !canUseMedicalDocumentGeneration(generation)
      ) {
        throw new MedicalDocumentImportError('STALE_DOCUMENT');
      }
      let repository: RecordRepository;
      let existing: SourceRecord | null;
      try {
        repository = await getRepository();
      } catch (error) {
        throw saveFailure('open', error);
      }
      try {
        existing = await repository.sourceRecords.findByContentHash(
          document.contentHash,
        );
      } catch (error) {
        throw saveFailure('lookup', error);
      }
      if (!canUseMedicalDocumentGeneration(generation)) {
        throw new MedicalDocumentImportError('STALE_DOCUMENT');
      }
      if (existing) {
        if (existing.id === document.id) possiblyCommitted.add(document.id);
        await preserveDuplicateOriginal(files, existing, document, generation);
        return 'duplicate';
      }

      const timestamp = getTimestamp();
      const source = makeMedicalDocumentSourceRecord(document, timestamp);
      const spans = makeMedicalDocumentEvidenceSpans(document, timestamp);
      if (spans.length === 0) {
        throw new MedicalDocumentImportError('EMPTY_DOCUMENT');
      }

      try {
        possiblyCommitted.add(document.id);
        await repository.transaction(async writer => {
          if (await writer.get('source_record', document.id)) {
            throw new Error('The document source identifier already exists.');
          }
          await writer.put('source_record', source);
          for (const span of spans) await writer.put('evidence_span', span);
        });
        if (!markMedicalDocumentPersisted(document.id, generation)) {
          throw new MedicalDocumentImportError('STALE_DOCUMENT');
        }
        return 'saved';
      } catch (error) {
        if (
          error instanceof MedicalDocumentImportError &&
          error.code === 'STALE_DOCUMENT'
        ) {
          throw error;
        }
        let duplicate: SourceRecord | null;
        try {
          duplicate = await repository.sourceRecords.findByContentHash(
            document.contentHash,
          );
        } catch {
          throw saveFailure('transaction', error);
        }
        if (duplicate) {
          if (duplicate.id !== document.id)
            possiblyCommitted.delete(document.id);
          await preserveDuplicateOriginal(
            files,
            duplicate,
            document,
            generation,
          );
          return 'duplicate';
        }
        possiblyCommitted.delete(document.id);
        // Keep the staged original available so the review can retry or cancel this save.
        throw saveFailure('transaction', error);
      }
    },
    async discardDocument(document) {
      // A commit may have succeeded before lifecycle invalidation; never delete its original.
      if (possiblyCommitted.has(document.id)) {
        let saved: SourceRecord | null;
        try {
          saved = await (await getRepository()).sourceRecords.get(document.id);
        } catch {
          throw new MedicalDocumentImportError('CLEANUP_FAILED');
        }
        if (saved) return;
      }
      await discardOriginal(files, document.id);
      possiblyCommitted.delete(document.id);
    },
  };
}

export const medicalDocumentImportService =
  createMedicalDocumentImportService();
