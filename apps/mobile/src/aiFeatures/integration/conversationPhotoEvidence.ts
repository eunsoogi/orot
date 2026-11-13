import type { ConversationSubmittedInput } from '../../ragConversation/conversationSubmittedInput';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { fingerprint } from './evidenceUtils';

/** Registers only this request's recognized sections; the original is never added to medical records. */
export function registerConversationPhotoEvidence(input: {
  readonly submitted: ConversationSubmittedInput;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly isCurrent: (signal: AbortSignal) => Promise<boolean>;
}) {
  const ocr = input.submitted.ocr;
  if (!ocr || !ocr.sections.length)
    throw new Error('Conversation photo has no recognized text.');
  return ocr.sections.map(section =>
    input.registry.add({
      reference: {
        sourceKind: 'personal_record',
        sourceId: ocr.source.id,
        sourceRevision: ocr.source.contentHash,
        evidenceId: section.id,
        evidenceRevision: fingerprint(section),
        locator: {
          kind: 'conversation_photo',
          requestId: input.submitted.requestId,
          sectionId: section.id,
        },
        effectiveTime: null,
        reviewState: 'unreviewed',
      },
      // This label preserves the user's chosen source even after internal IDs become aliases.
      content: `사용자가 현재 대화에 첨부한 사진에서 추출한 글자:\n${section.text}`,
      validate: signal => input.isCurrent(signal),
      async readSource(signal) {
        return (await input.isCurrent(signal))
          ? {
              status: 'available' as const,
              document: {
                sourceKind: 'conversation_photo' as const,
                requestId: input.submitted.requestId,
                sourceId: ocr.source.id,
                contentHash: ocr.source.contentHash,
                section,
              },
            }
          : { status: 'changed' as const };
      },
    }),
  );
}
