import type { JsonObject, JsonValue } from '@orot/model-runtime';
import { diseaseHypothesisSchema } from './resultValidation';

/** Keeps factual-summary field guidance identical across separately constrained source kinds. */
export function summarySectionSchema(referenceItems: JsonObject): JsonObject {
  return {
    ...diseaseHypothesisSchema,
    // Factual summaries may omit limitations; the disease-assessment schema keeps them required.
    required: ['title', 'summary', 'supportingEvidence', 'contraryEvidence'],
    properties: {
      // Choose the bounded topic source before prose; native enums otherwise encourage citing every ID.
      supportingEvidence: {
        type: 'array',
        minItems: 1,
        maxItems: 1,
        description:
          'Choose one exact supplied source for this section. Describe its concrete facts, not other records. A health-overview source already groups comparable observations for one topic; use separate sections for other sources. Use publication sources only for general medical context.',
        items: referenceItems,
      },
      ...Object.fromEntries(
        Object.entries(
          diseaseHypothesisSchema.properties as Record<string, JsonValue>,
        ).filter(
          ([key]) => !['uncertainty', 'supportingEvidence'].includes(key),
        ),
      ),
      // Factual summaries must not manufacture uncertainty to satisfy a diagnosis schema.
      contraryEvidence: {
        type: 'array',
        maxItems: 0,
        items: referenceItems,
        description:
          'Return an empty array. This is a factual record summary, not a disease hypothesis. Narrate differing supported observations with supportingEvidence instead.',
      },
      uncertaintyNotes: {
        type: 'array',
        maxItems: 3,
        items: { type: 'string', minLength: 1, maxLength: 500 },
        description:
          'Optional actual interpretive limitations, each written in Korean. Return an empty array or omit this property when none applies. Never add an English placeholder, abbreviation or unit alone. Do not invent uncertainty. Combined text must fit 500 characters.',
      },
      missingData: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: 160 },
        description:
          'Optional genuinely missing information needed for this summary. Write items in Korean. Omit this property or use an empty array when none is needed; never invent a gap.',
      },
    },
  };
}
