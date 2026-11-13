import {
  medicalDocumentFileDeletion,
  type MedicalDocumentFileDeletion,
} from '../medicalDocuments/medicalDocumentNativeBridge';
import {
  canUseMedicalDocumentGeneration,
  currentMedicalDocumentGeneration,
} from '../medicalDocuments/medicalDocumentLifecycle';

/** Verify an existing original without creating a copy or treating a saved consent as permission. */
export async function validateConversationPhotoOriginal(input: {
  readonly sourceId: string;
  readonly contentHash: string;
  readonly signal: AbortSignal;
  /** Rechecks the durable request, its source fence, and deletion generation. */
  readonly isCurrent: () => Promise<boolean>;
  readonly files?: Pick<MedicalDocumentFileDeletion, 'ensureOriginal'>;
}): Promise<boolean> {
  const { sourceId, contentHash, signal, isCurrent } = input;
  if (
    signal.aborted ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      sourceId,
    ) ||
    !/^sha256:[a-f0-9]{64}$/.test(contentHash)
  )
    return false;
  const generation = currentMedicalDocumentGeneration();
  try {
    if (
      !canUseMedicalDocumentGeneration(generation) ||
      !(await isCurrent()) ||
      signal.aborted
    )
      return false;
    // Equal IDs make native verification fail closed instead of recovering from another file.
    await (input.files ?? medicalDocumentFileDeletion).ensureOriginal(
      sourceId,
      sourceId,
      contentHash,
      generation,
    );
    if (signal.aborted || !canUseMedicalDocumentGeneration(generation))
      return false;
    return (
      (await isCurrent()) &&
      !signal.aborted &&
      canUseMedicalDocumentGeneration(generation)
    );
  } catch {
    return false;
  }
}
