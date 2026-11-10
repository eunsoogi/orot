import type { TaskResponderInput } from '@orot/agent-runtime';
import type { JsonObject } from '@orot/model-runtime';

/** Structured source fields let the app verify and render a publication result. */
const fields = [
  'evidenceId',
  'sourceRevision',
  'evidenceRevision',
  'populationSpan',
  'resultSpan',
  'statisticSpan',
  'limitationSpan',
  'measure',
  'value',
  'confidenceInterval',
];

export const literatureSchema = {
  type: 'array',
  items: {
    type: 'object',
    required: fields,
    properties: Object.fromEntries(
      fields.map(key => [key, { type: 'string' }]),
    ),
    additionalProperties: false,
  },
};

/** Shared result shape retains ordinary conversation alongside source-backed literature. */
export const conversationResultSchema = {
  type: 'object',
  required: ['answerKind', 'answer'],
  properties: {
    answerKind: {
      type: 'string',
      enum: ['conversation', 'grounded', 'prior_output'],
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
    completion: { type: 'string', enum: ['complete', 'partial'] },
  },
  additionalProperties: false,
};

/** The guided schema adds public-paper fields only when those sources are available. */
export const literatureConversationResultSchema = {
  ...conversationResultSchema,
  properties: {
    ...conversationResultSchema.properties,
    literature: literatureSchema,
    localClaims: {
      type: 'array',
      items: {
        type: 'object',
        required: ['sourceRevision', 'evidenceId', 'evidenceRevision', 'span'],
        properties: Object.fromEntries(
          ['sourceRevision', 'evidenceId', 'evidenceRevision', 'span'].map(
            key => [key, { type: 'string' }],
          ),
        ),
        additionalProperties: false,
      },
    },
  },
};

/** Avoid changing guided output for turns without Europe PMC evidence. */
export function selectConversationResultSchema(
  input: TaskResponderInput,
): JsonObject {
  return (
    input.evidence.items.some(
      item =>
        item.sourceKind === 'external_medical' &&
        item.sourceId === 'europe-pmc',
    )
      ? literatureConversationResultSchema
      : conversationResultSchema
  ) as JsonObject;
}
