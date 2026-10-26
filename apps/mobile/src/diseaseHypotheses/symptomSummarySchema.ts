import type { JsonObject } from '@orot/model-runtime';
import type { TaskResponderInput } from '@orot/agent-runtime';
import { summarySectionSchema } from './summarySectionSchema';
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
        items: summarySourceChoices(input, referenceItems),
      },
    },
    additionalProperties: false,
  };
}

/** Native generation chooses a source-specific shape so private facts cannot share publication citations. */
function summarySourceChoices(
  input: TaskResponderInput | undefined,
  fallback: JsonObject,
): JsonObject {
  const items = input?.evidence.items ?? [];
  const kinds = [...new Set(items.map(item => item.sourceKind))];
  if (kinds.length < 2) return summarySectionSchema(fallback);
  return {
    anyOf: kinds.map(kind => ({
      ...summarySectionSchema({
        type: 'string',
        enum: [
          ...new Set(
            items
              .filter(item => item.sourceKind === kind)
              .map(item => item.evidenceId),
          ),
        ],
      }),
      title:
        kind === 'external_medical'
          ? 'PublicMedicalContext'
          : kind === 'personal_record'
            ? 'PersonalRecordFacts'
            : 'ReviewedMemoryFacts',
      description:
        kind === 'external_medical'
          ? 'General medical context supported only by retrieved publications. Never treat it as a personal observation.'
          : 'Explicit personal facts from this source kind only. Keep general medical explanations in a separate public-context section.',
    })),
  };
}
