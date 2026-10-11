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

export interface RagConversationMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface GroundedRagAnswer {
  readonly answer: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

/** Makes every turn cite fresh evidence; chat history is never treated as a source. */
export const ragConversationTask: TaskResponderContract<GroundedRagAnswer> = {
  taskType: 'grounded_rag_conversation',
  taskVersion: '2',
  allowBoundedExternalEvidence: true,
  systemPrompt:
    'Answer the current question using only the supplied current evidence. Previous conversation is context, not evidence. ' +
    'Cite exact current evidence IDs in the top-level citations field. If evidence does not support an answer, request evidence or say that it is unavailable. ' +
    'Do not invent records, diagnoses, or sources. External medical publications are general literature, not personal findings. ' +
    'Describe external evidence as a limited search sample, never a complete review; include publication dates and limitations. Request literature evidence when relevant. ' +
    'Give a concise grounded answer, avoiding repeated evidence metadata. Preserve relevant qualifications and uncertainty.',
  resultSchema: {
    type: 'object',
    required: ['answer'],
    properties: { answer: { type: 'string', minLength: 1, maxLength: 4000 } },
    additionalProperties: false,
  } as JsonObject,
  createMessages(input: TaskResponderInput): readonly LanguageModelMessage[] {
    return [
      {
        role: 'user',
        content: JSON.stringify({
          question: input.request,
          previousConversation: priorMessages(input.context),
          // The runtime restores full references locally; generation needs content and citation IDs only.
          evidence: input.evidence.items.map(item => ({
            evidenceId: item.evidenceId,
            sourceKind: item.sourceKind,
            effectiveTime: item.effectiveTime,
            reviewState: item.reviewState,
            content: item.content,
          })),
          coverage: input.evidence.coverage,
          conflicts: input.evidence.conflicts,
        }),
      },
    ];
  },
  validateResult(value: JsonValue, input: TaskResponderInput) {
    if (!input.evidence.items.length) {
      return {
        status: 'needs_clarification',
        message: 'No current evidence is available.',
      } as const;
    }
    if (
      !isObject(value) ||
      Object.keys(value).some(key => key !== 'answer') ||
      typeof value.answer !== 'string' ||
      value.answer.trim().length === 0 ||
      value.answer.length > 4000
    ) {
      return {
        status: 'invalid',
        reason: 'The answer was empty or outside the supported size.',
      } as const;
    }
    return { status: 'valid', value: { answer: value.answer } } as const;
  },
};

export interface RagConversationCurrentEvidence {
  readonly batch: EvidenceBatch;
  readonly chunks: readonly import('@orot/rag').EvidenceChunk[];
}
