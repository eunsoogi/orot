import type { MultiAgentExecutionIdentity } from '@orot/agent-runtime';
import type {
  MedicalDocumentTextSection,
  StagedMedicalDocument,
} from '../medicalDocuments/medicalDocumentNativeBridge';

/** The saved consent description is provenance, never authorization for a later transmission. */
export type ConversationOcrTransmission = Pick<
  MultiAgentExecutionIdentity,
  'providerId' | 'modelId' | 'recipient' | 'remoteProcessing'
> & {
  readonly consentScope: NonNullable<
    MultiAgentExecutionIdentity['consentScope']
  >;
  readonly source: Pick<StagedMedicalDocument, 'id' | 'contentHash'>;
  readonly deletionGeneration: number;
  readonly sections: readonly MedicalDocumentTextSection[];
};

/** User text and transmitted OCR remain separate within one immutable request identity. */
export interface ConversationSubmittedInput {
  readonly schemaVersion: 1;
  readonly inputRevision: number;
  readonly sessionId: string;
  readonly requestId: string;
  readonly question: string;
  readonly ocr?: ConversationOcrTransmission;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every(key => allowed.includes(key));
}

/** Matches the canonical file key returned by the native medical-document store. */
export function isConversationPhotoSourceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  );
}

/** Persisted inputs are untrusted; accepting this shape does not replace consent or source checks. */
export function decodeConversationSubmittedInput(
  value: unknown,
): ConversationSubmittedInput | null {
  if (
    !record(value) ||
    !keys(value, [
      'schemaVersion',
      'inputRevision',
      'sessionId',
      'requestId',
      'question',
      'ocr',
    ]) ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.inputRevision) ||
    Number(value.inputRevision) < 0 ||
    typeof value.sessionId !== 'string' ||
    !value.sessionId ||
    value.sessionId.length > 200 ||
    typeof value.requestId !== 'string' ||
    !value.requestId ||
    value.requestId.length > 200 ||
    typeof value.question !== 'string' ||
    value.question.length > 1000
  )
    return null;
  try {
    if (JSON.stringify(value).length > 128_000) return null;
  } catch {
    return null;
  }
  if (value.ocr === undefined)
    return value.question.trim()
      ? (value as unknown as ConversationSubmittedInput)
      : null;
  const ocr = value.ocr;
  if (
    !record(ocr) ||
    !keys(ocr, [
      'providerId',
      'modelId',
      'recipient',
      'remoteProcessing',
      'consentScope',
      'source',
      'deletionGeneration',
      'sections',
    ]) ||
    !record(ocr.source) ||
    !keys(ocr.source, ['id', 'contentHash']) ||
    !isConversationPhotoSourceId(ocr.source.id) ||
    typeof ocr.source.contentHash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(ocr.source.contentHash) ||
    !Number.isSafeInteger(ocr.deletionGeneration) ||
    Number(ocr.deletionGeneration) < 0 ||
    !record(ocr.consentScope) ||
    !keys(ocr.consentScope, ['purpose', 'policyVersion', 'dataCategories']) ||
    typeof ocr.consentScope.purpose !== 'string' ||
    !ocr.consentScope.purpose ||
    typeof ocr.consentScope.policyVersion !== 'string' ||
    !ocr.consentScope.policyVersion ||
    !Array.isArray(ocr.consentScope.dataCategories) ||
    !ocr.consentScope.dataCategories.length ||
    ocr.consentScope.dataCategories.some(
      category => typeof category !== 'string' || !category,
    ) ||
    !['providerId', 'modelId', 'recipient'].every(
      key => typeof ocr[key] === 'string' && Boolean(ocr[key]),
    ) ||
    typeof ocr.remoteProcessing !== 'boolean' ||
    !Array.isArray(ocr.sections) ||
    !ocr.sections.length
  )
    return null;
  const ids = new Set<string>();
  for (const section of ocr.sections) {
    if (
      !record(section) ||
      !keys(section, [
        'id',
        'text',
        'startOffset',
        'endOffset',
        'pageNumber',
      ]) ||
      typeof section.id !== 'string' ||
      !section.id ||
      ids.has(section.id) ||
      typeof section.text !== 'string' ||
      !Number.isSafeInteger(section.startOffset) ||
      !Number.isSafeInteger(section.endOffset) ||
      Number(section.startOffset) < 0 ||
      Number(section.endOffset) < Number(section.startOffset) ||
      (section.pageNumber !== undefined &&
        (!Number.isSafeInteger(section.pageNumber) ||
          Number(section.pageNumber) < 1))
    )
      return null;
    ids.add(section.id);
  }
  if (
    !ocr.sections.some(
      section =>
        record(section) &&
        typeof section.text === 'string' &&
        section.text.trim(),
    )
  )
    return null;
  return value as unknown as ConversationSubmittedInput;
}
