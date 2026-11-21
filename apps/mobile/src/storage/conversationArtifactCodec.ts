import { validHistoricalDialogueParents } from './conversationHistoricalDialogue';
import { parseConversationMessageDelivery } from '../ragConversation/conversationMessageDelivery';
import { validConversationReportTarget } from './conversationReportTarget';
import { validConversationPhotoArtifactSource } from './conversationPhotoArtifactValidation';
import { isRecordKind } from '@orot/storage';
import { parseHealthContextScope } from '../healthEvidence/healthContext/scope';
import { hasConversationCitationReferences } from './conversationCitationMembership';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import { parseHealthSummaryReference } from '../ragConversation/healthSummary';
import { parseConversationVisitQuestionReference } from '../ragConversation/conversationVisitQuestionReference';
import { referenceOnly } from '../diseaseHypotheses/resultValidation';
import { hasValidTreatmentContext } from '../treatmentContext/validation';
import type { ConversationArtifact } from './conversationArtifactTypes';
export type { ConversationArtifact } from './conversationArtifactTypes';
import {
  artifactInputObject as object,
  validConversationArtifactInput,
} from './conversationArtifactInput';

/** Persisted JSON is untrusted; reject malformed dependencies before using their table identities. */
export function decodeConversationArtifact(
  serialized: unknown,
): ConversationArtifact | null {
  // Validate source and shape independently of content length; successful work must remain restorable.
  if (typeof serialized !== 'string') return null;
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
        'answer',
      ].every(
        key =>
          typeof value[key] === 'string' && (value[key] as string).length > 0,
      ) ||
      typeof value.question !== 'string' ||
      !Number.isFinite(Date.parse(value.createdAt as string)) ||
      new Date(value.createdAt as string).toISOString() !== value.createdAt ||
      (value.status !== 'complete' && value.status !== 'partial') ||
      (value.entryIntent !== undefined &&
        value.entryIntent !== 'possibilities') ||
      (value.dailyReport !== undefined &&
        !validConversationReportTarget(value.dailyReport)) ||
      (value.priorDialogue !== undefined &&
        (!Array.isArray(value.priorDialogue) ||
          value.priorDialogue.some(
            turn =>
              !object(turn) ||
              typeof turn.question !== 'string' ||
              typeof turn.answer !== 'string',
          ))) ||
      !validHistoricalDialogueParents(
        value.historicalDialogueParents,
        value.id,
      ) ||
      (value.priorUserReports !== undefined &&
        (!Array.isArray(value.priorUserReports) ||
          value.priorUserReports.some(report => typeof report !== 'string'))) ||
      (value.priorDialogueOmitted !== undefined &&
        value.priorDialogueOmitted !== true) ||
      !Array.isArray(value.sources)
    )
      return null;
    if (
      value.initialResponse !== undefined &&
      (!object(value.initialResponse) ||
        typeof value.initialResponse.callId !== 'string' ||
        !value.initialResponse.callId ||
        value.initialResponse.callId.length > 200 ||
        typeof value.initialResponse.text !== 'string' ||
        !value.initialResponse.text.trim() ||
        Object.keys(value.initialResponse).some(
          key => !['callId', 'text'].includes(key),
        ))
    )
      return null;
    if (!validConversationArtifactInput(value)) return null;
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
            ? [
                'symptom_summary',
                'disease_possibilities',
                'daily_report',
              ].includes(String(ref.locator.type))
            : source.kind === 'generated_conversation'
              ? ref.locator.type === 'conversation_turn'
              : ['research_publication', 'research_web_explanation'].includes(
                  String(ref.locator.type),
                ))
        )
          return null;
      } else if (source.kind === 'conversation_photo') {
        if (!validConversationPhotoArtifactSource(source, value)) return null;
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
    if (
      value.healthSummary !== undefined &&
      !parseHealthSummaryReference(value.healthSummary)
    )
      return null;
    const sources = value.sources as Record<string, unknown>[];
    if (!hasValidTreatmentContext(value)) return null;
    if (value.visitQuestions !== undefined) {
      const visit = parseConversationVisitQuestionReference(
        value.visitQuestions,
      );
      if (
        !visit ||
        !sources.some(
          source =>
            stableJson(source.reference) === stableJson(visit.source) &&
            Array.isArray(source.records) &&
            source.records.some(
              record =>
                object(record) &&
                record.kind === 'appointment' &&
                record.id === visit.appointmentId,
            ),
        )
      )
        return null;
      for (const question of visit.candidates) {
        for (const reference of [
          ...question.citations,
          ...(question.generatedArtifactContext ?? []),
        ]) {
          if (
            !sources.some(
              source =>
                stableJson(source.reference) ===
                stableJson(referenceOnly(reference)),
            )
          )
            return null;
        }
      }
    }
    if (
      value.citations !== undefined &&
      (!Array.isArray(value.citations) ||
        !hasConversationCitationReferences(sources, value.citations))
    )
      return null;
    // Bad optional receipts must not make a valid answer impossible to save.
    const delivery = parseConversationMessageDelivery(value.delivery);
    delete value.delivery;
    if (delivery) value.delivery = delivery;
    return value as unknown as ConversationArtifact;
  } catch {
    return null;
  }
}
