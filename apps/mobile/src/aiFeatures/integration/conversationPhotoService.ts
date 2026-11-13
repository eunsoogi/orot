import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { RagConversationServiceDependencies } from './ragConversationServiceDependencies';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { executionOptions } from './featureServiceExecution';
import { stableJson } from './evidenceUtils';
import { registerConversationPhotoEvidence } from './conversationPhotoEvidence';
import { authorizeConversationPhoto } from '../../ragConversation/conversationPhotoConsentAdapter';
import { fingerprint } from './evidenceUtils';

/** Recheck the saved source and the exact selected provider before a model can see the OCR. */
export async function prepareConversationPhoto(input: {
  readonly photo?: RagConversationObserver['photoInput'];
  readonly question: string;
  readonly sessionId: string | undefined;
  readonly selected: Awaited<
    ReturnType<RagConversationServiceDependencies['selectedAi']>
  >;
  readonly data: AiFeatureLocalData;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly signal: AbortSignal;
}) {
  const { photo, selected, data } = input;
  if (!photo) return undefined;
  const ocr = photo.submitted.ocr;
  if (
    !ocr ||
    photo.submitted.question !== input.question ||
    photo.submitted.sessionId !== input.sessionId ||
    selected.provider.id !== ocr.providerId ||
    selected.modelId !== ocr.modelId ||
    selected.recipient !== ocr.recipient ||
    selected.remoteProcessing !== ocr.remoteProcessing ||
    !data.validateConversationPhotoInput ||
    !(await data.validateConversationPhotoInput(photo.submitted, input.signal))
  )
    throw new Error('Conversation photo is unavailable.');
  return registerConversationPhotoEvidence({
    submitted: photo.submitted,
    registry: input.registry,
    isCurrent: signal =>
      data.validateConversationPhotoInput!(photo.submitted, signal),
  });
}

/** Consent provenance must match the actual task scope before the explicit payload decision. */
export function bindConversationPhotoExecution(
  base: ReturnType<typeof executionOptions>,
  photo: NonNullable<RagConversationObserver['photoInput']>,
  evidence: NonNullable<Awaited<ReturnType<typeof prepareConversationPhoto>>>,
  input: {
    readonly selected: Awaited<
      ReturnType<RagConversationServiceDependencies['selectedAi']>
    >;
    readonly data: AiFeatureLocalData;
    readonly registry: LocalEvidenceReferenceRegistry;
    readonly sessionVersion: number;
  },
) {
  const scope = {
    ...base.execution.consentScope,
    dataCategories: [
      ...base.execution.consentScope.dataCategories,
      'photo_ocr',
    ],
  };
  if (stableJson(scope) !== stableJson(photo.submitted.ocr?.consentScope))
    throw new Error('Conversation photo consent scope changed.');
  const ocr = photo.submitted.ocr!;
  return {
    ...base,
    execution: { ...base.execution, consentScope: scope },
    photoInput: {
      evidenceIds: evidence.map(item => item.evidenceId),
      consent: {
        async authorize(
          request: Parameters<typeof authorizeConversationPhoto>[0]['request'],
        ) {
          const result = await authorizeConversationPhoto({
            identity: {
              sessionId: photo.submitted.sessionId,
              sessionVersion: input.sessionVersion,
              requestId: photo.submitted.requestId,
              inputRevision: photo.submitted.inputRevision,
            },
            document: {
              ...ocr.source,
              sections: ocr.sections,
              ...(photo.previewData ? { previewData: photo.previewData } : {}),
            },
            stagingGeneration: photo.stagingGeneration,
            photoEvidence: evidence.map(item => ({
              evidenceId: item.evidenceId,
              content: item.content,
            })),
            selected: input.selected,
            request,
            async isCurrent() {
              if (
                !input.data.validateConversationPhotoInput ||
                !(await input.data.validateConversationPhotoInput(
                  photo.submitted,
                  request.signal,
                )) ||
                !(await input.registry.revalidateEvidence(
                  evidence,
                  request.signal,
                ))
              )
                return false;
              return evidence.every((item, index) => {
                const source = input.registry.resolve(item);
                const section = ocr.sections[index];
                return Boolean(
                  source &&
                  section &&
                  source.sourceId === ocr.source.id &&
                  source.sourceRevision === ocr.source.contentHash &&
                  source.evidenceId === section.id &&
                  source.evidenceRevision === fingerprint(section) &&
                  item.content ===
                    input.registry.redactText(
                      `사용자가 현재 대화에 첨부한 사진에서 추출한 글자:\n${section.text}`,
                    ),
                );
              });
            },
            confirm: photo.confirm,
          });
          return result === 'authorized'
            ? ('authorized' as const)
            : ('renewal_required' as const);
        },
      },
    },
  };
}
