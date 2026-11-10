import type { SourceRecord } from '@orot/domain';
import {
  MedicalDocumentImportError,
  markMedicalDocumentPersisted,
} from './medicalDocumentNativeBridge';
import type {
  MedicalDocumentFileDeletion,
  StagedMedicalDocument,
} from './medicalDocumentNativeBridge';

/** Log only a closed stage token; database errors may contain private content or paths. */
export function saveFailure(
  stage: 'open' | 'lookup' | 'transaction',
  error: unknown,
): MedicalDocumentImportError {
  console.warn('[medical-document-save]', stage, 'SAVE_FAILED');
  return new MedicalDocumentImportError('SAVE_FAILED', error);
}

/** Restores a missing retained file before removing a newly selected duplicate. */
export async function preserveDuplicateOriginal(
  files: MedicalDocumentFileDeletion,
  retainedSource: SourceRecord,
  document: StagedMedicalDocument,
  generation: number,
): Promise<void> {
  // The hash index is shared across source kinds; only documents own these originals.
  if (retainedSource.sourceKind !== 'medical_document') {
    throw new MedicalDocumentImportError('DUPLICATE_RECOVERY_FAILED');
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
    throw new MedicalDocumentImportError('DUPLICATE_RECOVERY_FAILED');
  }
  if (!markMedicalDocumentPersisted(retainedSource.id, generation)) {
    throw new MedicalDocumentImportError('STALE_DOCUMENT');
  }
  if (retainedSource.id !== document.id)
    await discardOriginal(files, document.id);
}

export async function discardOriginal(
  files: MedicalDocumentFileDeletion,
  sourceId: string,
): Promise<void> {
  try {
    await files.discard(sourceId);
  } catch {
    throw new MedicalDocumentImportError('CLEANUP_FAILED');
  }
}
