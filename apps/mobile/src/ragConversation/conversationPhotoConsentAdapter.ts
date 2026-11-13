import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import type { StagedMedicalDocument } from '../medicalDocuments/medicalDocumentNativeBridge';
import {
  canUseMedicalDocumentGeneration,
  getMedicalDocumentGeneration,
} from '../medicalDocuments/medicalDocumentLifecycle';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import { photoEvidenceCapability } from './conversationPhotoCapability';
import type { PhotoRequestIdentity } from './conversationPhotoHandoff';

type Selection = {
  readonly provider: {
    readonly id: LanguageModelProvider['id'];
    readonly displayName: string;
    readonly capabilities: Pick<
      LanguageModelProvider['capabilities'],
      'inputTypes'
    >;
  };
  readonly modelId: string;
  readonly recipient: string;
  readonly remoteProcessing: boolean;
};

/** Stop waiting on a stale decision even if an external confirmation surface never resolves. */
async function waitForPhotoDecision<T>(
  signal: AbortSignal,
  work: () => Promise<T>,
): Promise<T> {
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error('Photo request cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([
      cancelled,
      Promise.resolve().then(() => {
        if (signal.aborted) throw new Error('Photo request cancelled.');
        return work();
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

/** Confirm that the exact OCR sections, rather than an omitted or replaced attachment, reach the request. */
function containsPhotoEvidence(
  request: OutboundProcessingRequest,
  document: StagedMedicalDocument,
  photoEvidenceIds: readonly string[],
): boolean {
  const evidence: unknown[] = [];
  for (const message of request.payload.messages) {
    if (!('content' in message)) continue;
    if (
      Array.isArray(message.content) &&
      message.content.some(part => part.type !== 'text')
    )
      return false;
    if (message.role !== 'user' || typeof message.content !== 'string')
      continue;
    try {
      const value: unknown = JSON.parse(message.content);
      if (
        value &&
        typeof value === 'object' &&
        'evidence' in value &&
        Array.isArray(value.evidence)
      )
        evidence.push(...value.evidence);
    } catch {
      // Ordinary user messages need not contain an evidence envelope.
    }
  }
  return document.sections.every((section, index) => {
    const matches = evidence.filter(
      item =>
        item &&
        typeof item === 'object' &&
        'evidenceId' in item &&
        item.evidenceId === photoEvidenceIds[index],
    );
    return (
      matches.length === 1 &&
      matches.every(
        item =>
          item &&
          typeof item === 'object' &&
          'sourceKind' in item &&
          item.sourceKind === 'personal_record' &&
          'content' in item &&
          item.content === section.text,
      )
    );
  });
}

/** A photo-specific decision never substitutes for the runtime's normal remote-payload consent. */
export async function authorizeConversationPhoto(input: {
  readonly identity: PhotoRequestIdentity;
  readonly document: StagedMedicalDocument;
  readonly stagingGeneration: number;
  /** Turn-local evidence aliases, in the same order as the OCR sections. */
  readonly photoEvidenceIds: readonly string[];
  readonly selected: Selection;
  readonly request: OutboundProcessingRequest;
  /** Revalidates file, source, request and each alias-to-section mapping against their real owners. */
  readonly isCurrent: () => Promise<boolean>;
  /** Present an explicit decision for this provider and close the prompt when its signal aborts. */
  readonly confirm: (
    details: {
      readonly providerName: string;
      readonly modelId: string;
      readonly recipient: string;
      readonly remoteProcessing: boolean;
    },
    signal: AbortSignal,
  ) => Promise<boolean>;
}): Promise<'authorized' | 'consent_required' | 'unavailable' | 'cancelled'> {
  const { document, stagingGeneration, selected, request } = input;
  const valid = () =>
    Boolean(input.identity.sessionId && input.identity.requestId) &&
    Number.isSafeInteger(input.identity.sessionVersion) &&
    input.identity.sessionVersion >= 0 &&
    Number.isSafeInteger(input.identity.inputRevision) &&
    input.identity.inputRevision >= 0 &&
    /^sha256:[0-9a-f]{64}$/i.test(document.contentHash) &&
    new Set(document.sections.map(section => section.id)).size ===
      document.sections.length &&
    input.photoEvidenceIds.length === document.sections.length &&
    new Set(input.photoEvidenceIds).size === input.photoEvidenceIds.length &&
    input.photoEvidenceIds.every(id => Boolean(id)) &&
    document.sections.every(
      section =>
        Boolean(section.id && section.text.trim()) &&
        Number.isSafeInteger(section.startOffset) &&
        section.startOffset >= 0 &&
        Number.isSafeInteger(section.endOffset) &&
        section.endOffset - section.startOffset === section.text.length,
    ) &&
    canUseMedicalDocumentGeneration(stagingGeneration) &&
    getMedicalDocumentGeneration(document.id) === stagingGeneration &&
    photoEvidenceCapability(selected.provider.capabilities, document) ===
      'ocr' &&
    Boolean(
      selected.provider.displayName.trim() &&
      selected.modelId.trim() &&
      selected.recipient.trim(),
    ) &&
    selected.provider.id === request.providerId &&
    selected.modelId === request.modelId &&
    selected.recipient === request.recipient &&
    selected.remoteProcessing === request.remoteProcessing &&
    request.consentScope?.purpose === 'record_conversation' &&
    Boolean(request.consentScope.policyVersion) &&
    request.consentScope.dataCategories.includes('photo_ocr') &&
    request.allowedScope.sourceKinds.includes('personal_record') &&
    !(
      document.previewData &&
      stableJson(request.payload).includes(
        document.previewData.split(',')[1] ?? document.previewData,
      )
    ) &&
    containsPhotoEvidence(request, document, input.photoEvidenceIds);
  const snapshot = () =>
    stableJson({
      identity: input.identity,
      photoEvidenceIds: input.photoEvidenceIds,
      source: {
        id: document.id,
        hash: document.contentHash,
        sections: document.sections,
        stagingGeneration,
      },
      selected: {
        providerId: selected.provider.id,
        providerName: selected.provider.displayName,
        modelId: selected.modelId,
        recipient: selected.recipient,
        remoteProcessing: selected.remoteProcessing,
        inputTypes: selected.provider.capabilities.inputTypes,
      },
      scope: request.consentScope,
      allowedScope: request.allowedScope,
      payload: request.payload,
    });
  if (request.signal.aborted) return 'cancelled';
  try {
    if (
      !valid() ||
      !(await waitForPhotoDecision(request.signal, input.isCurrent))
    )
      return 'unavailable';
    const before = snapshot();
    if (
      !(await waitForPhotoDecision(request.signal, () =>
        input.confirm(
          Object.freeze({
            providerName: selected.provider.displayName,
            modelId: selected.modelId,
            recipient: selected.recipient,
            remoteProcessing: selected.remoteProcessing,
          }),
          request.signal,
        ),
      ))
    )
      return request.signal.aborted ? 'cancelled' : 'consent_required';
    if (request.signal.aborted) return 'cancelled';
    if (
      !valid() ||
      snapshot() !== before ||
      !(await waitForPhotoDecision(request.signal, input.isCurrent))
    )
      return 'unavailable';
    if (request.signal.aborted) return 'cancelled';
    return snapshot() === before ? 'authorized' : 'unavailable';
  } catch {
    return request.signal.aborted ? 'cancelled' : 'unavailable';
  }
}
