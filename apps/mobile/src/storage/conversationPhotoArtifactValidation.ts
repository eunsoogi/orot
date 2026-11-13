import { decodeConversationSubmittedInput } from '../ragConversation/conversationSubmittedInput';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';

/** A photo citation is valid only for the exact protected request, original and recognized section. */
export function validConversationPhotoArtifactSource(
  source: Record<string, unknown>,
  value: Record<string, unknown>,
): boolean {
  const submitted = decodeConversationSubmittedInput(value.submittedInput);
  const ref = source.reference;
  if (!submitted?.ocr || !ref || typeof ref !== 'object' || Array.isArray(ref))
    return false;
  const reference = ref as Record<string, unknown>;
  const locator = reference.locator;
  if (!locator || typeof locator !== 'object' || Array.isArray(locator))
    return false;
  const location = locator as Record<string, unknown>;
  const section = submitted.ocr.sections.find(
    item => item.id === source.sectionId,
  );
  return (
    Object.keys(source).every(key =>
      ['kind', 'reference', 'requestId', 'sectionId'].includes(key),
    ) &&
    Object.keys(location).every(key =>
      ['kind', 'requestId', 'sectionId'].includes(key),
    ) &&
    source.requestId === value.id &&
    source.requestId === submitted.requestId &&
    submitted.sessionId === value.sessionId &&
    reference.sourceKind === 'personal_record' &&
    reference.reviewState === 'unreviewed' &&
    reference.effectiveTime === null &&
    reference.unit === undefined &&
    reference.sourceId === submitted.ocr.source.id &&
    reference.sourceRevision === submitted.ocr.source.contentHash &&
    reference.evidenceId === source.sectionId &&
    location.kind === 'conversation_photo' &&
    location.requestId === source.requestId &&
    location.sectionId === source.sectionId &&
    Boolean(section && reference.evidenceRevision === fingerprint(section))
  );
}
