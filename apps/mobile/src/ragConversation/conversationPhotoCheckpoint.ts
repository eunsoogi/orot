import type { createConversationPhotoImport } from './conversationPhotoImport';
import type { ConversationSubmittedInput } from './conversationSubmittedInput';
import type { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';

type Lease = NonNullable<
  ReturnType<ReturnType<typeof createConversationPhotoImport>['beginHandoff']>
>;
type Storage = Pick<
  ReturnType<typeof createConversationArtifactStorage>,
  'readRequestInput'
>;

/** Resolve ownership only after a protected checkpoint is known to own the exact source. */
export async function commitConversationPhotoCheckpoint(input: {
  readonly lease: Lease;
  readonly submitted: ConversationSubmittedInput;
  readonly storage: Storage;
  readonly start: () => Promise<void>;
  readonly deferCommit?: boolean;
  /** Retryable retirement owns both the database fence and native cleanup. */
  readonly retire: (sourceId: string) => Promise<void>;
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
  const commit = async () => {
    const ownership = lease.commit();
    if (!ownership)
      throw new Error('Conversation attachment handoff is unavailable.');
    if (ownership.removed) {
      try {
        // Tombstone and dependent answers first, then retire the separately protected original.
        await input.retire(sourceId);
        ownership.acknowledgeRemoval({ ok: true });
      } catch (error) {
        ownership.acknowledgeRemoval({ ok: false, error });
        throw error;
      }
      throw new Error('Conversation attachment was removed.');
    }
  };
  if (startFailed) {
    // An unreadable acknowledgement may still have committed; fence before cleanup.
    let current: ConversationSubmittedInput | null = null;
    try {
      current = await storage.readRequestInput(
        submitted.requestId,
        submitted.sessionId,
        lease.identity.sessionVersion,
      );
    } catch {
      // Treat an unavailable read as ambiguous, not as proof of absence.
    }
    if (!current || stableJson(current) !== stableJson(submitted)) {
      await commit();
      await input.retire(sourceId);
      throw startError;
    }
  }
  if (input.deferCommit && !startFailed) return { commit };
  await commit();
  if (startFailed) throw startError;
}
