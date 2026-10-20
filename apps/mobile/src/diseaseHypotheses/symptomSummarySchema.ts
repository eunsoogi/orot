import type { JsonObject, JsonValue } from '@orot/model-runtime';
import type { TaskResponderInput } from '@orot/agent-runtime';
import { diseaseHypothesisSchema } from './resultValidation';
import { MAX_SYMPTOM_SUMMARY_SECTIONS } from './types';
import { SUMMARY_SYMPTOM_COVERAGE_NOTE } from './summaryCoverageNotes';

/** Native guidance restricts citation strings to this request's batch; exact reference and fact checks still run locally. */
export function createSymptomSummarySchema(
  input?: TaskResponderInput,
): JsonObject {
  const ids = input?.evidence.items.map(item => item.evidenceId) ?? [];
  const referenceItems: JsonObject = ids.length
    ? { type: 'string', enum: [...new Set(ids)] }
    : { type: 'string', minLength: 1 };
  return {
    type: 'object',
    required: ['sections'],
    properties: {
      coverageNotes: {
        type: 'array',
        maxItems: 1,
        uniqueItems: true,
        description:
          'Optional verified limitations of the supplied records, never absence from the whole app. Do not repeat these as standalone sections.',
        items: { type: 'string', enum: [SUMMARY_SYMPTOM_COVERAGE_NOTE] },
      },
      sections: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_SYMPTOM_SUMMARY_SECTIONS,
        items: {
          ...diseaseHypothesisSchema,
          // Factual summaries may omit limitations; the disease-assessment schema keeps them required.
          required: [
            'title',
            'summary',
            'supportingEvidence',
            'contraryEvidence',
          ],
          properties: {
            ...Object.fromEntries(
              Object.entries(
                diseaseHypothesisSchema.properties as Record<string, JsonValue>,
              ).filter(([key]) => key !== 'uncertainty'),
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
            supportingEvidence: {
              type: 'array',
              minItems: 1,
              description:
                'Exact evidenceId strings from one sourceKind only. Use personal_record for record facts or external_medical for general medical context; never combine both kinds in one section.',
              items: referenceItems,
            },
          },
        },
      },
    },
    additionalProperties: false,
  };
}
