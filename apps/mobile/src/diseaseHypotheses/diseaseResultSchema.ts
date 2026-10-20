import type { JsonObject } from '@orot/model-runtime';

// The model emits opaque IDs; the app restores exact, current references after validation.
const referenceSchema: JsonObject = { type: 'string', minLength: 1 };

export const diseaseHypothesisSchema: JsonObject = {
  type: 'object',
  required: [
    'title',
    'summary',
    'supportingEvidence',
    'contraryEvidence',
    'uncertainty',
    'missingData',
  ],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 },
    summary: { type: 'string', minLength: 1, maxLength: 1200 },
    supportingEvidence: { type: 'array', minItems: 1, items: referenceSchema },
    contraryEvidence: { type: 'array', items: referenceSchema },
    uncertainty: { type: 'string', minLength: 1, maxLength: 500 },
    missingData: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 160 },
    },
  },
  additionalProperties: false,
};
