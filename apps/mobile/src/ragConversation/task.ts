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
import { extractPartialJsonStringAtPath } from '@orot/agent-runtime';

export interface RagConversationMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface GroundedRagAnswer {
  readonly answer: string;
  /** Omitted legacy values remain grounded; only explicit social/clarifying replies need no sources. */
  readonly answerKind?: 'grounded' | 'conversation';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Exposes the recorded event state explicitly; a calendar title is not an observed encounter. */
function appointmentState(content: string): string | undefined {
  if (!content.startsWith('appointment: ')) return undefined;
  try {
    const record: unknown = JSON.parse(content.slice('appointment: '.length));
    return isObject(record) && typeof record.status === 'string'
      ? record.status
      : undefined;
  } catch {
    // Unstructured text remains verbatim evidence, never an inferred appointment state.
    return undefined;
  }
}

function priorMessages(
  context: JsonValue | undefined,
): readonly RagConversationMessage[] {
  if (!Array.isArray(context)) return [];
  return context.slice(-8).flatMap(message => {
    if (
      !isObject(message) ||
      (message.role !== 'user' && message.role !== 'assistant') ||
      typeof message.content !== 'string'
    )
      return [];
    return [{ role: message.role, content: message.content.slice(0, 2000) }];
  });
}

/** Distinguishes non-factual dialogue from claims needing current sources; history is context only. */
export const ragConversationTask: TaskResponderContract<GroundedRagAnswer> = {
  taskType: 'grounded_rag_conversation',
  taskVersion: '5',
  allowBoundedExternalEvidence: true,
  allowRankedLocalEvidence: true,
  isEvidenceIndependentResult(value) {
    return isObject(value) && value.answerKind === 'conversation';
  },
  systemPrompt:
    'Choose answerKind=conversation for greetings, acknowledgements, emotional support without factual or clinical claims, and questions that clarify what the user means. Reply naturally without citations or an evidence disclaimer. Do not require a search merely to continue a conversation. ' +
    'Choose answerKind=grounded for claims about records, health measurements, medications, symptoms or medical knowledge. Retrieve supporting evidence when absent; never label such claims conversation to evade grounding. If a turn mixes social language with a substantive health question, use grounded. ' +
    'For grounded answers, use only the supplied current evidence. Previous conversation is context, not evidence. ' +
    'Cite exact current evidence IDs in the top-level citations field. ' +
    'Local evidence is a ranked search sample, not an exhaustive medication list or medical history. Say what the retrieved records support and never infer absence from omitted results. ' +
    'For broad health questions or trends prefer local-health-context (30 days, summary detail by default) for full-period medication, measurement, activity, sleep and symptom statistics. Choose 7 or 90 days, weekly or daily detail when needed, and use raw-record search for drilldown. If unavailable use view=health_overview. Missing days are unknown, not zero or missed medication. Never add overlapping sensor step series or infer a complete night from calendar-day sleep durations. The model chooses each tool and query. ' +
    'Respect sourceSemantics: step_count amounts in count are steps, never occurrences. Sleep stages describe individual intervals, not episode counts or whole-night totals. Convert clock times to displayTimeZone, or label the retained source time zone explicitly. ' +
    // An empty personal library does not establish that public literature is unavailable.
    'When the user explicitly asks for literature and current sources do not support the answer, request evidence before declaring it unavailable if literature research is permitted. ' +
    'If research is denied, exhausted, or returned no supporting results, acknowledge insufficient evidence; do not invent an answer or repeatedly request the same search. ' +
    'Do not invent records, diagnoses, or sources. External medical publications are general literature, not personal findings. ' +
    'Describe external evidence as a limited search sample, never a complete review; include publication dates and limitations. Request literature evidence when relevant. ' +
    'For a simple record question, answer in one short Korean sentence using only relevant facts. Do not repeat unrelated evidence or metadata. Keep IDs only in citations, never in the answer text. ' +
    'For medications, distinguish a recorded dose or prescription from confirmed current use; do not claim an old dose proves current use. Preserve qualifications and uncertainty. ' +
    'Preserve event status and source-relative time. A scheduled event or intention is not an ongoing or completed event; a completed event is not ongoing. Never turn a future plan into a present-tense fact. ' +
    'Write the user-facing answer in Korean. Keep publication titles in their original form.',
  resultSchema: {
    type: 'object',
    required: ['answerKind', 'answer'],
    properties: {
      answerKind: {
        type: 'string',
        enum: ['conversation', 'grounded'],
        description:
          'Conversation contains no factual record or medical claims; grounded answers require current supporting evidence and citations.',
      },
      answer: {
        type: 'string',
        minLength: 1,
        maxLength: 4000,
        description:
          'A direct Korean answer using the requested record topics and their limits. A simple fact may need one sentence; a question across topics may need short paragraphs. Omit unrelated plans, internal IDs and field names.',
      },
    },
    additionalProperties: false,
  } as JsonObject,
  projectStreamedText(rawOutput, input) {
    // An unsupported evidence-free factual draft must not appear before its required lookup.
    if (
      !input.evidence.items.length &&
      extractPartialJsonStringAtPath(rawOutput, ['value', 'answerKind']) !==
        'conversation'
    )
      return undefined;
    return extractPartialJsonStringAtPath(rawOutput, ['value', 'answer']);
  },
  createMessages(input: TaskResponderInput): readonly LanguageModelMessage[] {
    return [
      {
        role: 'user',
        content: JSON.stringify({
          question: input.request,
          displayTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          answerRequirements:
            'Answer directly in Korean, briefly for a simple fact and in short paragraphs for multiple requested topics. Use available follow-up tools for missing requested topics before treating a partial search as insufficient. For medication questions, report recorded medications and dose facts without unrelated consultation plans. Describe the state at the record time rather than asserting current status.',
          temporalRequirements:
            'scheduled/rescheduled means planned, completed means finished, and cancelled means cancelled. An event title or consultation intention does not establish ongoing or completed care. Resolve relative times against the source record time, not today.',
          previousConversation: priorMessages(input.context),
          // The runtime restores full references locally; generation needs content and citation IDs only.
          evidence: input.evidence.items.map(item => ({
            evidenceId: item.evidenceId,
            sourceKind: item.sourceKind,
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
        key => key !== 'answer' && key !== 'answerKind',
      ) ||
      ('answerKind' in value &&
        value.answerKind !== 'grounded' &&
        value.answerKind !== 'conversation') ||
      typeof value.answer !== 'string' ||
      value.answer.trim().length === 0 ||
      value.answer.length > 4000
    ) {
      return {
        status: 'invalid',
        reason: 'The answer was empty or outside the supported size.',
      } as const;
    }
    if (value.answerKind !== 'conversation' && !input.evidence.items.length) {
      return {
        status: 'needs_clarification',
        message: 'No current evidence is available.',
      } as const;
    }
    return {
      status: 'valid',
      value: {
        answer: value.answer,
        ...(value.answerKind === 'conversation' ||
        value.answerKind === 'grounded'
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
