/** Keeps local document extraction and protected-file lifecycle behind one typed native boundary. */
import { NativeModules } from 'react-native';
import { medicalDocumentOriginalPhotoErrorCodes } from './medicalDocumentOriginalPhotoTypes';
import type {
  MedicalDocumentOriginalPhotoErrorCode,
  StoredMedicalDocumentPhoto,
} from './medicalDocumentOriginalPhotoTypes';
export type { StoredMedicalDocumentPhoto } from './medicalDocumentOriginalPhotoTypes';
import {
  canUseMedicalDocumentGeneration,
  confirmMedicalDocumentReconciliation,
  currentMedicalDocumentGeneration,
  discardMedicalDocumentFromLifecycle,
  markMedicalDocumentPersistedInLifecycle,
  medicalDocumentReconciliationIds,
  protectedMedicalDocumentSourceIds,
  trackStagedMedicalDocument,
} from './medicalDocumentLifecycle';

export interface MedicalDocumentTextSection {
  readonly id: string;
  readonly text: string;
  readonly pageNumber?: number;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface StagedMedicalDocument {
  readonly id: string;
  readonly displayName: string;
  readonly contentHash: `sha256:${string}`;
  readonly sections: readonly MedicalDocumentTextSection[];
  readonly previewData?: string;
}

export type MedicalDocumentImportErrorCode =
  | 'SCANNED_PDF_UNSUPPORTED'
  | 'UNSUPPORTED_DOCUMENT'
  | 'UNSUPPORTED_TEXT_ENCODING'
  | 'EMPTY_DOCUMENT'
  | 'FILE_PROTECTION_UNAVAILABLE'
  | 'CLEANUP_FAILED'
  | 'SAVE_FAILED'
  | 'STALE_DOCUMENT'
  | 'DUPLICATE_RECOVERY_FAILED'
  | 'NATIVE_UNAVAILABLE'
  | MedicalDocumentOriginalPhotoErrorCode
  | 'IMPORT_FAILED';

export class MedicalDocumentImportError extends Error {
  constructor(
    readonly code: MedicalDocumentImportErrorCode,
    readonly originalError?: unknown,
  ) {
    super(code);
    this.name = 'MedicalDocumentImportError';
  }
}

export interface MedicalDocumentFileDeletion {
  reconcile(sourceIds: readonly string[], generation?: number): Promise<void>;
  stage(sourceId: string): Promise<void>;
  restore(sourceId: string): Promise<void>;
  commit(sourceId: string): Promise<void>;
  ensureOriginal(
    retainedSourceId: string,
    stagedSourceId: string,
    expectedContentHash: string,
    generation?: number,
  ): Promise<void>;
  discard(sourceId: string): Promise<void>;
}

interface MedicalDocumentNativeModule {
  pickMedicalDocument(): Promise<StagedMedicalDocument | null>;
  pickMedicalDocumentPhoto(): Promise<StagedMedicalDocument | null>;
  loadMedicalDocumentOriginalPhoto(
    sourceId: string,
    expectedContentHash: string | null,
  ): Promise<StoredMedicalDocumentPhoto>;
  discardMedicalDocument(sourceId: string): Promise<void>;
  ensureMedicalDocumentOriginal(
    retainedSourceId: string,
    stagedSourceId: string,
    expectedContentHash: string,
  ): Promise<void>;
  reconcileMedicalDocumentFiles(sourceIds: string[]): Promise<void>;
  stageMedicalDocumentDeletion(sourceId: string): Promise<void>;
  restoreMedicalDocumentDeletion(sourceId: string): Promise<void>;
  commitMedicalDocumentDeletion(sourceId: string): Promise<void>;
}

const nativeCodes = new Set<MedicalDocumentImportErrorCode>([
  'SCANNED_PDF_UNSUPPORTED',
  'UNSUPPORTED_DOCUMENT',
  'UNSUPPORTED_TEXT_ENCODING',
  'EMPTY_DOCUMENT',
  'FILE_PROTECTION_UNAVAILABLE',
  'CLEANUP_FAILED',
  ...medicalDocumentOriginalPhotoErrorCodes,
  'NATIVE_UNAVAILABLE',
  'IMPORT_FAILED',
]);

let fileOperationTail: Promise<void> = Promise.resolve();

function serializeFileOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = fileOperationTail.then(operation);
  fileOperationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function getProtectedMedicalDocumentSourceIds(): Promise<
  string[]
> {
  await fileOperationTail;
  return protectedMedicalDocumentSourceIds();
}

export function markMedicalDocumentPersisted(
  sourceId: string,
  generation = currentMedicalDocumentGeneration(),
): boolean {
  return markMedicalDocumentPersistedInLifecycle(sourceId, generation);
}

function normalizeError(error: unknown): MedicalDocumentImportError {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  return new MedicalDocumentImportError(
    typeof code === 'string' &&
      nativeCodes.has(code as MedicalDocumentImportErrorCode)
      ? (code as MedicalDocumentImportErrorCode)
      : 'IMPORT_FAILED',
  );
}

function nativeModule(): MedicalDocumentNativeModule {
  const module = NativeModules.MedicalDocumentImportModule as
    MedicalDocumentNativeModule | undefined;
  if (!module) throw new MedicalDocumentImportError('NATIVE_UNAVAILABLE');
  return module;
}

async function callNative<T>(
  operation: (module: MedicalDocumentNativeModule) => Promise<T>,
): Promise<T> {
  try {
    return await operation(nativeModule());
  } catch (error) {
    throw normalizeError(error);
  }
}

export const medicalDocumentNativeBridge = {
  pick: (source: 'files' | 'photos' = 'files') => {
    const generation = currentMedicalDocumentGeneration();
    return serializeFileOperation(async () => {
      if (!canUseMedicalDocumentGeneration(generation)) {
        throw new MedicalDocumentImportError('IMPORT_FAILED');
      }
      const document = await callNative(module =>
        source === 'photos'
          ? module.pickMedicalDocumentPhoto()
          : module.pickMedicalDocument(),
      );
      if (document) trackStagedMedicalDocument(document.id);
      return document;
    });
  },
  discard: (sourceId: string) =>
    serializeFileOperation(async () => {
      await callNative(module => module.discardMedicalDocument(sourceId));
      discardMedicalDocumentFromLifecycle(sourceId);
    }),
  loadOriginalPhoto: (sourceId: string, expectedContentHash: string | null) =>
    serializeFileOperation(async () => {
      const photo = await callNative(module =>
        module.loadMedicalDocumentOriginalPhoto(sourceId, expectedContentHash),
      );
      const allowedMimeTypes = new Set([
        'image/jpeg',
        'image/heic',
        'image/png',
      ]);
      if (
        photo.sourceId !== sourceId ||
        !allowedMimeTypes.has(photo.mimeType) ||
        photo.base64Data.length === 0
      ) {
        throw new MedicalDocumentImportError('CORRUPT_ORIGINAL');
      }
      return photo;
    }),
};

export const medicalDocumentFileDeletion: MedicalDocumentFileDeletion = {
  reconcile: (sourceIds, generation = currentMedicalDocumentGeneration()) =>
    serializeFileOperation(async () => {
      const retainedIds = medicalDocumentReconciliationIds(
        sourceIds,
        generation,
      );
      if (retainedIds === null) return;
      await callNative(module =>
        module.reconcileMedicalDocumentFiles(retainedIds),
      );
      confirmMedicalDocumentReconciliation(sourceIds, generation);
    }),
  stage: sourceId =>
    serializeFileOperation(() =>
      callNative(module => module.stageMedicalDocumentDeletion(sourceId)),
    ),
  restore: sourceId =>
    serializeFileOperation(() =>
      callNative(module => module.restoreMedicalDocumentDeletion(sourceId)),
    ),
  /** Native cleanup runs after the database owner has retired its entire source batch. */
  commit: sourceId =>
    serializeFileOperation(() =>
      callNative(module => module.commitMedicalDocumentDeletion(sourceId)),
    ),
  ensureOriginal: (
    retainedSourceId,
    stagedSourceId,
    expectedContentHash,
    generation = currentMedicalDocumentGeneration(),
  ) =>
    serializeFileOperation(() => {
      if (!canUseMedicalDocumentGeneration(generation)) {
        throw new MedicalDocumentImportError('IMPORT_FAILED');
      }
      return callNative(module =>
        module.ensureMedicalDocumentOriginal(
          retainedSourceId,
          stagedSourceId,
          expectedContentHash,
        ),
      );
    }),
  discard: sourceId => medicalDocumentNativeBridge.discard(sourceId),
};
