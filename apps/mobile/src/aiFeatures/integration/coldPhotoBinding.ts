import type { ConversationColdResumeDescriptor } from '../../storage/conversationColdResumeDescriptor';
import { decodeConversationSubmittedInput } from '../../ragConversation/conversationSubmittedInput';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';

/** The protected input owns OCR; the invocation contains only ordered evidence IDs, never a grant. */
export function readColdPhotoBinding(
  descriptor: ConversationColdResumeDescriptor,
  confirm: RagConversationObserver['confirmPhotoResume'],
) {
  const original = descriptor.reconstruction.invocation as
    { photo?: unknown } | undefined;
  const photo = original?.photo;
  if (photo === null && descriptor.submittedInput === null) return undefined;
  if (
    !photo ||
    typeof photo !== 'object' ||
    Array.isArray(photo) ||
    Object.keys(photo).some(key => key !== 'evidenceIds') ||
    !('evidenceIds' in photo) ||
    !Array.isArray(photo.evidenceIds) ||
    !photo.evidenceIds.length ||
    photo.evidenceIds.some(id => typeof id !== 'string' || !id) ||
    new Set(photo.evidenceIds).size !== photo.evidenceIds.length ||
    !descriptor.submittedInput ||
    !confirm
  )
    throw new Error('Cold photo binding or fresh confirmation unavailable.');
  const submitted = decodeConversationSubmittedInput(
    JSON.parse(descriptor.submittedInput),
  );
  const owner = {
    requestId: descriptor.manifest.requestId,
    sessionId: descriptor.manifest.sessionId,
    sessionVersion: descriptor.manifest.sessionVersion,
  };
  if (
    !submitted?.ocr ||
    submitted.question !== descriptor.request ||
    submitted.requestId !== owner.requestId ||
    submitted.sessionId !== owner.sessionId
  )
    throw new Error('Cold photo input does not belong to this request.');
  return {
    submitted,
    owner,
    evidenceIds: [...photo.evidenceIds] as string[],
    confirm,
  };
}
