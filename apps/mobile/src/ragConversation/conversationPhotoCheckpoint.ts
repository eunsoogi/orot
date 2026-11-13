import type { createConversationPhotoImport } from './conversationPhotoImport';
import type { ConversationSubmittedInput } from './conversationSubmittedInput';
import type { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import { medicalDocumentFileDeletion } from '../medicalDocuments/medicalDocumentNativeBridge';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';

type Lease = NonNullable<
  ReturnType<ReturnType<typeof createConversationPhotoImport>['beginHandoff']>
>;
type Storage = Pick<
  ReturnType<typeof createConversationArtifactStorage>,
  'readRequestInput' | 'invalidateRequestSource'
>;

/** Resolve ownership only after a protected checkpoint is known to own the exact source. */
export async function commitConversationPhotoCheckpoint(input: {
  readonly lease: Lease;
  readonly submitted: ConversationSubmittedInput;
  readonly storage: Storage;
  readonly start: () => Promise<void>;
  readonly discard?: (sourceId: string) => Promise<void>;
}) {
  const { lease, submitted, storage } = input;
  const sourceId = lease.photo.id;
  if (
    !submitted.ocr ||
    submitted.ocr.source.id !== sourceId ||
    submitted.ocr.source.contentHash !== lease.photo.contentHash ||
    submitted.sessionId !== lease.identity.sessionId ||
    submitted.requestId !== lease.identity.requestId ||
    submitted.inputRevision !== lease.identity.inputRevision ||
    stableJson(submitted.ocr.sections) !== stableJson(lease.photo.sections)
  ) {
    // No checkpoint was attempted, so the staged draft can safely return to its owner.
    await lease.rollback();
    throw new Error('Conversation attachment does not match the request.');
  }
  let startError: unknown;
  let startFailed = false;
  try {
    await input.start();
  } catch (error) {
    startFailed = true;
    startError = error;
  }
  if (startFailed) {
    // A failed acknowledgement may follow a committed write; null can also mean a hidden session.
    const current = await storage.readRequestInput(
      submitted.requestId,
      submitted.sessionId,
      lease.identity.sessionVersion,
    );
    if (!current || stableJson(current) !== stableJson(submitted))
      throw startError;
  }
  const ownership = lease.commit();
  if (!ownership)
    throw new Error('Conversation attachment handoff is unavailable.');
  if (ownership.removed) {
    try {
      // Tombstone and dependent answers first, then retire the separately protected original.
      await storage.invalidateRequestSource(sourceId);
      await (input.discard ?? medicalDocumentFileDeletion.discard)(sourceId);
      ownership.acknowledgeRemoval({ ok: true });
    } catch (error) {
      ownership.acknowledgeRemoval({ ok: false, error });
      throw error;
    }
    throw new Error('Conversation attachment was removed.');
  }
  if (startFailed) throw startError;
}
