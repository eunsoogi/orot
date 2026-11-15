import type {
  JsonObject,
  JsonValue,
  LanguageModelMessage,
} from '@orot/model-runtime';
import type {
  EvidenceBatch,
  TaskResponderContract,
  TaskResponderInput,
} from '@orot/agent-runtime';
import { t } from '../i18n';
import { hasUnsupportedClinicalClaim } from './clinicalClaimValidation';
import { renderMixedEvidenceAnswer } from './mixedEvidenceAnswer';
import type { LocalClaimIdentity } from './localEvidenceClaims';
import {
  conversationResultSchema,
  selectConversationResultSchema,
} from './literatureSchema';
import type { LiteratureIdentity } from './literatureCitationBinding';
import { appointmentState, isObject, priorMessages } from './taskHistory';
import {
  isEvidenceIndependentConversation,
  requestsLiteratureExplanation,
} from './literatureIntent';
import { conversationTaskInput } from './conversationEntryContext';
import { priorDialogue } from './priorDialogue';
import { possibilityPrompt } from './possibilityPrompt';
import * as initialReply from './initialResponse';
export interface RagConversationMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}
export interface GroundedRagAnswer {
  readonly answer: string;
  /** A validated answer may cover only part of the user's request. */
  readonly completion?: 'complete' | 'partial';
  /** Omitted legacy values remain grounded; only explicit social/clarifying replies need no sources. */
  readonly answerKind?: 'grounded' | 'conversation' | 'prior_output';
  readonly literatureReferences?: readonly LiteratureIdentity[];
  readonly localReferences?: readonly LocalClaimIdentity[];
}

/** Distinguishes dialogue from claims needing current sources; history is context only.
 * Publish prose only after complete-response validation. Tool progress has its own observer. */
export const ragConversationTask: TaskResponderContract<GroundedRagAnswer> = {
  taskType: 'grounded_rag_conversation',
  taskVersion: '7',
  initialToolResponse: initialReply.validateInitialConversationResponse,
  allowBoundedExternalEvidence: true,
  allowRankedLocalEvidence: true,
  allowPagedGeneratedArtifacts: true,
  // Only the observed envelope-shape error permits one budgeted correction; normal citation validation still applies.
  correctionInstructionForInvalidEnvelope(reason) {
    if (
      reason !== 'The task responder returned an invalid envelope: citations.'
    )
      return undefined;
    return 'Return the complete result envelope with citations as an array of exact current evidenceId strings used in the answer. Use each ID at most once and do not invent references. Preserve only facts supported by the supplied evidence; an evidence-independent conversation has an empty citations array.';
  },
  isEvidenceIndependentResult: isEvidenceIndependentConversation,
  systemPrompt:
    initialReply.initialResponseInstruction +
    'Choose answerKind=conversation for greetings, acknowledgements, emotional support without factual or clinical claims, and questions that clarify what the user means. Reply naturally without citations or an evidence disclaimer. Do not require a search merely to continue a conversation. ' +
    'Choose answerKind=grounded for claims about records, health measurements, medications, symptoms or medical knowledge. Retrieve supporting evidence when absent; never label such claims conversation to evade grounding. If a turn mixes social language with a substantive health question, use grounded. ' +
    'Choose answerKind=prior_output only to show a previously generated result; cite generated artifact IDs. The application will display the retained text itself. ' +
    'For grounded answers, use only the supplied current evidence. Previous conversation is context, not evidence. ' +
    'When entryContext identifies a selected visit by evidence ID, use that visit as the requested target and do not replace it with another appointment. ' +
    'A generated_artifact is a historical AI output, not an independent medical fact or corroboration. When asked about a prior output, identify its origin, generation date, uncertainty and source status. For clinical claims retrieve and cite the underlying current sources separately. A paged result is not an exhaustive search; use its nextCursor for more results. When asked to continue on a later turn, reuse the earlier search query so the local tool continues its saved page. ' +
    possibilityPrompt +
    'Cite exact current evidence IDs in the top-level citations field. ' +
    'Set completion to partial when the answer provides useful supported information but cannot address all requested topics; explain the missing portion. Otherwise set it to complete. Never use partial to bypass evidence or citation requirements. ' +
    'Local evidence is a ranked search sample, not an exhaustive medication list or medical history. Say what the retrieved records support and never infer absence from omitted results. ' +
    'For broad health questions or trends prefer local-health-context (30 days, summary detail by default) for full-period medication, measurement, activity, sleep and symptom statistics. Choose 7 or 90 days, or an explicit window for a requested period, and weekly or daily detail when needed; use raw-record search for drilldown. If unavailable use view=health_overview. Missing days are unknown, not zero or missed medication. Never add overlapping sensor step series or infer a complete night from calendar-day sleep durations. The model chooses each tool and query. ' +
    'Respect sourceSemantics: step_count amounts in count are steps, never occurrences. Sleep stages describe individual intervals, not episode counts or whole-night totals. Convert clock times to displayTimeZone, or label the retained source time zone explicitly. ' +
    // An empty personal library does not establish that public literature is unavailable.
    'When the user explicitly asks for literature and current sources do not support the answer, request evidence before declaring it unavailable if literature research is permitted. ' +
    'If research is denied, exhausted, or returned no supporting results, acknowledge insufficient evidence; do not invent an answer or repeatedly request the same search. ' +
    'Do not invent records, diagnoses, or sources. External publications and public-web search explanations are general context, not personal findings. ' +
    'Use public-web-search when general web sources beyond Europe PMC are needed. Its output is a cited model-generated explanation, never original passages or Europe PMC papers. Use only supplied source dates; a retrieval time is not a publication date. ' +
    'Describe external evidence as a limited search sample, never a complete review; include publication dates and limitations. Request literature evidence when relevant. ' +
    // Bibliographic identity and historical snapshots do not establish a study's findings or present status.
    'For each relevant publication, explain the study population, results, applicability to the question and relevant limitations only when its actual abstract supplies them; otherwise say what cannot be determined. Bibliographic metadata supports identification only, not clinical results. Historical publication metadata cannot substitute for a fresh abstract. Cite exact current evidence IDs and distinguish general research from personal records. Never infer that full text was read, that a paper was peer reviewed, or that it was not retracted from silence. ' +
    // Statistical measures and uncertainty must retain their source meaning, including in translation.
    'Preserve each reported statistical measure exactly: an odds ratio is an odds ratio, not a risk ratio, hazard ratio, absolute risk or percentage increase in risk. Never exchange or convert these measures without the necessary data. Distinguish association from causation and accurately describe the evidence grade and material uncertainty, including heterogeneity when relevant to the reported result. ' +
    'For Europe PMC sources provide literature entries with exact evidenceId, sourceRevision, evidenceRevision and verbatim populationSpan, resultSpan and limitationSpan from the abstract. Include the outcome and context in resultSpan. Use an empty limitationSpan when absent. For an explicit OR, RR or HR with 95% CI, copy the exact statisticSpan within resultSpan and its values, using odds_ratio, risk_ratio or hazard_ratio. Otherwise use qualitative and empty statisticSpan, value and confidenceInterval. Cite the same evidence IDs. The application renders these fields; do not rely on free-text answer for publication claims. ' +
    'When publication evidence is present, report personal records only as localClaims with exact evidenceId, sourceRevision, evidenceRevision and complete unchanged content in span. Cite every displayed record. The application renders source-backed claims and states when a comparison is unverified. ' +
    'For a simple record question, answer in one short Korean sentence using only relevant facts. Do not repeat unrelated evidence or metadata. Keep IDs only in citations, never in the answer text. ' +
    'For medications, distinguish a recorded dose or prescription from confirmed current use; do not claim an old dose proves current use. Preserve qualifications and uncertainty. ' +
    'For a requested period, use an explicit time-zone-aware window with inclusive start and exclusive end, at most 90 local calendar days. For a specific medication and date or time, add doseHistory and select only medications; follow hasMore pages as needed. A scheduled time is not an intake time, and only an explicit taken or administered event establishes recorded intake. ' +
    'Preserve event status and source-relative time. A scheduled event or intention is not an ongoing or completed event; a completed event is not ongoing. Never turn a future plan into a present-tense fact. ' +
    'Write the user-facing answer in Korean. Keep publication titles in their original form.',
  resultSchema: conversationResultSchema as JsonObject,
  createResultSchema: selectConversationResultSchema,
  // Keep the guided provider stream observer active without projecting provisional text.
  projectStreamedText: () => undefined,
  createMessages(input: TaskResponderInput): readonly LanguageModelMessage[] {
    return [
      {
        role: 'user',
        content: JSON.stringify({
          ...conversationTaskInput(
            input.request,
            input.context,
            input.evidence.items,
          ),
          initialResponseText: initialReply.initialConversationResponse,
          answerRequirements:
            'Answer directly in Korean, briefly for a simple fact and in short paragraphs for multiple requested topics. Use available follow-up tools for missing requested topics before treating a partial search as insufficient. For medication questions, report recorded medications and dose facts without unrelated consultation plans. Describe the state at the record time rather than asserting current status.',
          temporalRequirements:
            'scheduled/rescheduled means planned, completed means finished, and cancelled means cancelled. An event title or consultation intention does not establish ongoing or completed care. Resolve relative times against the source record time, not today.',
          previousConversation: priorMessages(input.context),
          priorDialogue: priorDialogue(input.context),
          priorDialogueOmitted:
            isObject(input.context) &&
            input.context.priorDialogueOmitted === true,
          // The runtime restores full references locally; generation needs content and citation IDs only.
          evidence: input.evidence.items.map(item => ({
            evidenceId: item.evidenceId,
            sourceKind: item.sourceKind,
            ...(item.sourceKind === 'external_medical' ||
            (item.sourceKind === 'personal_record' &&
              input.evidence.items.some(
                source =>
                  source.sourceKind === 'external_medical' &&
                  source.sourceId === 'europe-pmc',
              ))
              ? {
                  sourceRevision: item.sourceRevision,
                  evidenceRevision: item.evidenceRevision,
                }
              : {}),
            effectiveTime: item.effectiveTime,
            reviewState: item.reviewState,
            content: item.content,
            ...(appointmentState(item.content)
              ? { eventState: appointmentState(item.content) }
              : {}),
          })),
          coverage: input.evidence.coverage,
          conflicts: input.evidence.conflicts,
        }),
      },
    ];
  },
  validateResult(value: JsonValue, input: TaskResponderInput) {
    if (
      !isObject(value) ||
      Object.keys(value).some(
        key =>
          key !== 'answer' &&
          key !== 'answerKind' &&
          key !== 'completion' &&
          key !== 'literature' &&
          key !== 'localClaims',
      ) ||
      ('completion' in value &&
        value.completion !== 'complete' &&
        value.completion !== 'partial') ||
      ('answerKind' in value &&
        value.answerKind !== 'grounded' &&
        value.answerKind !== 'conversation' &&
        value.answerKind !== 'prior_output') ||
      typeof value.answer !== 'string' ||
      (value.answer.trim().length === 0 &&
        !('literature' in value) &&
        !('localClaims' in value)) ||
      value.answer.length > 4000
    ) {
      return {
        status: 'invalid',
        reason: 'The answer was empty or outside the supported size.',
      } as const;
    }
    if (
      value.answerKind === 'conversation' &&
      requestsLiteratureExplanation(input.request)
    )
      return {
        status: 'needs_clarification',
        message: t('ragConversation.literature.requestEvidenceUnavailable'),
      } as const;
    if (value.answerKind !== 'conversation' && !input.evidence.items.length) {
      return {
        status: 'needs_clarification',
        message: 'No current evidence is available.',
      } as const;
    }
    if ('literature' in value || 'localClaims' in value) {
      const rendered = renderMixedEvidenceAnswer(
        value,
        input.evidence.items,
        input.request,
      );
      if (!rendered)
        return {
          status: 'needs_clarification',
          message: t('ragConversation.literature.statisticsSourceMismatch'),
        } as const;
      return {
        status: 'valid',
        value: {
          answer: rendered.answer,
          answerKind: 'grounded' as const,
          ...(value.completion === 'partial' || rendered.partial
            ? { completion: 'partial' as const }
            : {}),
          literatureReferences: rendered.literatureReferences,
          localReferences: rendered.localReferences,
        },
      } as const;
    }
    if (
      value.answerKind !== 'conversation' &&
      value.answerKind !== 'prior_output' &&
      (requestsLiteratureExplanation(input.request) ||
        input.evidence.items.some(item => item.sourceId === 'europe-pmc'))
    ) {
      // Plain prose cannot establish literature claims or a record-to-literature comparison.
      return {
        status: 'needs_clarification',
        message: t('ragConversation.literature.explanationSourceMismatch'),
      } as const;
    }
    // A model instruction alone cannot prevent a definitive diagnosis from reaching the user.
    if (hasUnsupportedClinicalClaim(value.answer, input)) {
      return {
        status: 'invalid',
        reason: 'The answer contained a definitive clinical claim.',
      } as const;
    }
    return {
      status: 'valid',
      value: {
        answer: value.answer,
        ...(value.completion === 'partial'
          ? { completion: 'partial' as const }
          : {}),
        ...(value.answerKind === 'conversation' ||
        value.answerKind === 'grounded' ||
        value.answerKind === 'prior_output'
          ? { answerKind: value.answerKind }
          : {}),
      },
    } as const;
  },
};
export interface RagConversationCurrentEvidence {
  readonly batch: EvidenceBatch;
  readonly chunks: readonly import('@orot/rag').EvidenceChunk[];
}
