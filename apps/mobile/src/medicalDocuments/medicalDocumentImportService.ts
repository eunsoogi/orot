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
      evidenceSpans.sort(compareMedicalDocumentEvidenceSpans);
      return { ...source, evidenceSpans };
    },
    async selectDocument() {
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
      const document = await pick();
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
        throw new MedicalDocumentImportError('IMPORT_FAILED');
      }
      const repository = await getRepository();
      const existing = await repository.sourceRecords.findByContentHash(
        document.contentHash,
      );
      if (!canUseMedicalDocumentGeneration(generation)) {
        throw new MedicalDocumentImportError('IMPORT_FAILED');
      }
      if (existing) {
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
        await repository.transaction(async writer => {
          if (await writer.get('source_record', document.id)) {
            throw new Error('The document source identifier already exists.');
          }
          await writer.put('source_record', source);
          for (const span of spans) await writer.put('evidence_span', span);
        });
        if (!markMedicalDocumentPersisted(document.id, generation)) {
          throw new MedicalDocumentImportError('IMPORT_FAILED');
        }
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
          await preserveDuplicateOriginal(
            files,
            duplicate,
            document,
            generation,
          );
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

/** Restores a missing retained file before removing a newly selected duplicate. */
async function preserveDuplicateOriginal(
  files: MedicalDocumentFileDeletion,
  retainedSource: SourceRecord,
  document: StagedMedicalDocument,
  generation: number,
): Promise<void> {
  // The content-hash index is shared across source kinds; only documents own these originals.
  if (retainedSource.sourceKind !== 'medical_document') {
    throw new MedicalDocumentImportError('IMPORT_FAILED');
  }

  // A restored database may retain provenance after its excluded original file is absent.
  try {
    await files.ensureOriginal(
      retainedSource.id,
      document.id,
      document.contentHash,
      generation,
    );
  } catch {
    throw new MedicalDocumentImportError('IMPORT_FAILED');
  }

  // Keep a recovered canonical file protected until reconciliation reads its database row.
  if (!markMedicalDocumentPersisted(retainedSource.id, generation)) {
    throw new MedicalDocumentImportError('IMPORT_FAILED');
  }
  if (retainedSource.id !== document.id) {
    await discardOriginal(files, document.id);
  }
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
