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
  discard(sourceId: string): Promise<void>;
}

interface MedicalDocumentNativeModule {
  pickMedicalDocument(): Promise<StagedMedicalDocument | null>;
  discardMedicalDocument(sourceId: string): Promise<void>;
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
  pick: () => callNative(module => module.pickMedicalDocument()),
  discard: (sourceId: string) =>
    callNative(module => module.discardMedicalDocument(sourceId)),
};

export const medicalDocumentFileDeletion: MedicalDocumentFileDeletion = {
  reconcile: sourceIds =>
    callNative(module => module.reconcileMedicalDocumentFiles([...sourceIds])),
  stage: sourceId =>
    callNative(module => module.stageMedicalDocumentDeletion(sourceId)),
  restore: sourceId =>
    callNative(module => module.restoreMedicalDocumentDeletion(sourceId)),
  commit: sourceId =>
    callNative(module => module.commitMedicalDocumentDeletion(sourceId)),
  discard: sourceId =>
    callNative(module => module.discardMedicalDocument(sourceId)),
};
