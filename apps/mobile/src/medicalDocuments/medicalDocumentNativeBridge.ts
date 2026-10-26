/** Keeps local document extraction and protected-file lifecycle behind one typed native boundary. */
import { NativeModules } from 'react-native';

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
}

export type MedicalDocumentImportErrorCode =
  | 'SCANNED_PDF_UNSUPPORTED'
  | 'UNSUPPORTED_DOCUMENT'
  | 'UNSUPPORTED_TEXT_ENCODING'
  | 'EMPTY_DOCUMENT'
  | 'FILE_PROTECTION_UNAVAILABLE'
  | 'CLEANUP_FAILED'
  | 'NATIVE_UNAVAILABLE'
  | 'IMPORT_FAILED';

export class MedicalDocumentImportError extends Error {
  constructor(readonly code: MedicalDocumentImportErrorCode) {
    super(code);
    this.name = 'MedicalDocumentImportError';
  }
}

export interface MedicalDocumentFileDeletion {
  reconcile(sourceIds: readonly string[]): Promise<void>;
  stage(sourceId: string): Promise<void>;
  restore(sourceId: string): Promise<void>;
  commit(sourceId: string): Promise<void>;
  ensureOriginal(
    retainedSourceId: string,
    stagedSourceId: string,
    expectedContentHash: string,
  ): Promise<void>;
  discard(sourceId: string): Promise<void>;
}

interface MedicalDocumentNativeModule {
  pickMedicalDocument(): Promise<StagedMedicalDocument | null>;
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
  'NATIVE_UNAVAILABLE',
  'IMPORT_FAILED',
]);

// Keep selected and newly persisted originals until a repository-backed reconcile confirms their IDs.
const activeStagedDocumentIds = new Set<string>();
const persistedAwaitingReconciliationIds = new Set<string>();
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
  return [
    ...new Set([
      ...activeStagedDocumentIds,
      ...persistedAwaitingReconciliationIds,
    ]),
  ];
}

export function markMedicalDocumentPersisted(sourceId: string): void {
  activeStagedDocumentIds.delete(sourceId);
  persistedAwaitingReconciliationIds.add(sourceId);
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
  pick: () =>
    serializeFileOperation(async () => {
      const document = await callNative(module => module.pickMedicalDocument());
      if (document) activeStagedDocumentIds.add(document.id);
      return document;
    }),
  discard: (sourceId: string) =>
    serializeFileOperation(async () => {
      await callNative(module => module.discardMedicalDocument(sourceId));
      activeStagedDocumentIds.delete(sourceId);
      persistedAwaitingReconciliationIds.delete(sourceId);
    }),
};

export const medicalDocumentFileDeletion: MedicalDocumentFileDeletion = {
  reconcile: sourceIds =>
    serializeFileOperation(async () => {
      const persistedIds = new Set(sourceIds);
      await callNative(module =>
        module.reconcileMedicalDocumentFiles([
          ...new Set([
            ...persistedIds,
            ...activeStagedDocumentIds,
            ...persistedAwaitingReconciliationIds,
          ]),
        ]),
      );
      for (const sourceId of persistedIds) {
        activeStagedDocumentIds.delete(sourceId);
        persistedAwaitingReconciliationIds.delete(sourceId);
      }
    }),
  stage: sourceId =>
    serializeFileOperation(() =>
      callNative(module => module.stageMedicalDocumentDeletion(sourceId)),
    ),
  restore: sourceId =>
    serializeFileOperation(() =>
      callNative(module => module.restoreMedicalDocumentDeletion(sourceId)),
    ),
  commit: sourceId =>
    serializeFileOperation(async () => {
      await callNative(module =>
        module.commitMedicalDocumentDeletion(sourceId),
      );
      activeStagedDocumentIds.delete(sourceId);
      persistedAwaitingReconciliationIds.delete(sourceId);
    }),
  ensureOriginal: (retainedSourceId, stagedSourceId, expectedContentHash) =>
    serializeFileOperation(() =>
      callNative(module =>
        module.ensureMedicalDocumentOriginal(
          retainedSourceId,
          stagedSourceId,
          expectedContentHash,
        ),
      ),
    ),
  discard: sourceId => medicalDocumentNativeBridge.discard(sourceId),
};
