import { isRecordKind } from '@orot/storage';
import type { ConversationArtifactSource } from '../ragConversation/conversationArtifactSources';
import type { EvidenceReference } from '@orot/agent-runtime';
import { parseHealthContextScope } from '../healthEvidence/healthContext/scope';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';

export const CONVERSATION_SOURCE_LIMIT = 24;

export interface ConversationArtifact {
  readonly id: string;
  readonly sessionId: string;
  readonly createdAt: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly entryIntent?: 'possibilities';
  readonly priorDialogue?: readonly { question: string; answer: string }[];
  readonly priorUserReports?: readonly string[];
  readonly priorDialogueOmitted?: true;
  readonly status: 'complete' | 'partial';
  readonly question: string;
  readonly answer: string;
  readonly sources: readonly ConversationArtifactSource[];
  readonly citations?: readonly EvidenceReference[];
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Persisted JSON is untrusted; reject malformed dependencies before using their table identities. */
export function decodeConversationArtifact(
  serialized: unknown,
): ConversationArtifact | null {
  if (typeof serialized !== 'string' || serialized.length > 128_000)
    return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (
      !object(value) ||
      ![
        'id',
        'sessionId',
        'createdAt',
        'providerId',
        'modelId',
        'question',
        'answer',
      ].every(
        key =>
          typeof value[key] === 'string' && (value[key] as string).length > 0,
      ) ||
      !Number.isFinite(Date.parse(value.createdAt as string)) ||
      new Date(value.createdAt as string).toISOString() !== value.createdAt ||
      (value.status !== 'complete' && value.status !== 'partial') ||
      (value.entryIntent !== undefined &&
        value.entryIntent !== 'possibilities') ||
      (value.priorDialogue !== undefined &&
        (!Array.isArray(value.priorDialogue) ||
          value.priorDialogue.length > 4 ||
          value.priorDialogue.some(
            turn =>
              !object(turn) ||
              typeof turn.question !== 'string' ||
              turn.question.length > 1000 ||
              typeof turn.answer !== 'string' ||
              turn.answer.length > 1000,
          ))) ||
      (value.priorUserReports !== undefined &&
        (!Array.isArray(value.priorUserReports) ||
          value.priorUserReports.length > 8 ||
          value.priorUserReports.some(
            report => typeof report !== 'string' || report.length > 2000,
          ))) ||
      (value.priorDialogueOmitted !== undefined &&
        value.priorDialogueOmitted !== true) ||
      !Array.isArray(value.sources) ||
      value.sources.length > CONVERSATION_SOURCE_LIMIT
    )
      return null;
    for (const source of value.sources) {
      if (!object(source) || !object(source.reference)) return null;
      const ref = source.reference;
      if (
        (ref.sourceKind !== 'personal_record' &&
          ref.sourceKind !== 'reviewed_memory' &&
          ref.sourceKind !== 'external_medical' &&
          ref.sourceKind !== 'generated_artifact') ||
        (ref.effectiveTime !== null && typeof ref.effectiveTime !== 'string') ||
        (ref.reviewState !== 'reviewed' &&
          ref.reviewState !== 'unreviewed' &&
          ref.reviewState !== 'unknown') ||
        (ref.unit !== undefined && typeof ref.unit !== 'string') ||
        !('locator' in ref) ||
        !['sourceId', 'sourceRevision', 'evidenceId', 'evidenceRevision'].every(
          key =>
            typeof ref[key] === 'string' && (ref[key] as string).length > 0,
        )
      )
        return null;
      if (
        source.kind === 'generated_summary' ||
        source.kind === 'generated_conversation' ||
        source.kind === 'generated_research'
      ) {
        if (
          ref.sourceKind !== 'generated_artifact' ||
          typeof source.id !== 'string' ||
          !source.id ||
          typeof source.revision !== 'string' ||
          !source.revision ||
          ref.sourceId !== source.id ||
          ref.evidenceId !== source.id ||
          ref.sourceRevision !== source.revision ||
          ref.evidenceRevision !== source.revision ||
          !object(ref.locator) ||
          ref.locator.kind !== 'generated_artifact' ||
          !(source.kind === 'generated_summary'
            ? ['symptom_summary', 'disease_possibilities'].includes(
                String(ref.locator.type),
              )
            : source.kind === 'generated_conversation'
              ? ref.locator.type === 'conversation_turn'
              : ['research_publication', 'research_web_explanation'].includes(
                  String(ref.locator.type),
                ))
        )
          return null;
      } else if (source.kind === 'health_context_period') {
        const scope = parseHealthContextScope(source.scope);
        if (
          !scope ||
          ref.sourceKind !== 'personal_record' ||
          JSON.stringify(parseHealthContextScope(ref.locator)) !==
            JSON.stringify(scope) ||
          typeof source.revision !== 'string' ||
          !source.revision ||
          ref.sourceRevision !== source.revision ||
          ref.evidenceRevision !== source.revision ||
          !Number.isSafeInteger(source.deletionGeneration) ||
          Number(source.deletionGeneration) < 0
        )
          return null;
      } else {
        if (
          ref.sourceKind === 'generated_artifact' ||
          (object(ref.locator) &&
            ref.locator.kind === 'health_context_period') ||
          !Array.isArray(source.records) ||
          source.records.length > 32 ||
          (ref.sourceKind !== 'external_medical' &&
            source.records.length === 0) ||
          (ref.sourceKind === 'external_medical' &&
            source.records.length !== 0) ||
          source.records.some(
            record =>
              !object(record) ||
              typeof record.kind !== 'string' ||
              !(
                isRecordKind(record.kind) ||
                record.kind === 'reviewed_memory' ||
                record.kind === 'manual_history'
              ) ||
              typeof record.id !== 'string' ||
              !record.id ||
              typeof record.revision !== 'string' ||
              !record.revision,
          )
        )
          return null;
      }
    }
    const sources = value.sources as Record<string, unknown>[];
    if (
      value.citations !== undefined &&
      (!Array.isArray(value.citations) ||
        value.citations.length > 24 ||
        value.citations.some(
          citation =>
            !sources.some(
              source => stableJson(source.reference) === stableJson(citation),
            ),
        ))
    )
      return null;
    return value as unknown as ConversationArtifact;
  } catch {
    return null;
  }
}
