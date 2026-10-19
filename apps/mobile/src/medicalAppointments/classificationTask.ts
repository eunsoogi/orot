import type { JsonObject, JsonValue } from '@orot/model-runtime';
import type {
  TaskResponderContract,
  TaskResponderInput,
  TaskResultValidation,
} from '@orot/agent-runtime';

import {
  classificationDecisions,
  expandClassificationDecisions,
} from './classificationDecision';

export type MedicalRelevance = 'medical' | 'non_medical' | 'uncertain';
export type ClassificationUncertainty = 'low' | 'medium' | 'high';

export interface AppointmentClassification {
  readonly candidateId: string;
  readonly classification: MedicalRelevance;
  readonly reason: string;
  readonly uncertainty: ClassificationUncertainty;
}

export interface AppointmentClassificationResult {
  readonly classifications: readonly AppointmentClassification[];
}

const taskSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['classifications'],
  properties: {
    classifications: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['candidateId', 'decision'],
        properties: {
          candidateId: { type: 'string' },
          decision: { type: 'string', enum: classificationDecisions },
        },
      },
    },
  },
} satisfies JsonObject;

const taskInstructions = [
  'Classify each supplied upcoming Calendar event only for whether it appears to be a medical appointment.',
  'Use only the supplied event title and time. Do not infer a diagnosis, give health advice, or invent missing details.',
  'Return exactly one item for every candidateId and no others. Use uncertain when the event is ambiguous.',
  'Return one decision per candidate: combine medical, non_medical, or uncertain with low, medium, or high uncertainty using an underscore (for example medical_low or non_medical_high). The app supplies the fixed Korean explanation; do not generate extra fields.',
  // Confidence concerns appointment relevance, never the person's condition or diagnosis.
  'Uncertainty measures only whether this is a medical appointment. Use low when the title explicitly names a clinic, hospital visit, examination, treatment, or consultation appointment; medium or high when that purpose is unclear. Do not increase uncertainty merely because clinical details are absent.',
  'Do not request more evidence; return uncertain when the supplied event text is insufficient.',
].join(' ');

/** Builds a bounded responder contract; local validation prevents missing or duplicated candidates. */
export function createAppointmentClassificationTask(
  candidateIds: readonly string[] = [],
  onInvalid?: (reason: string) => void,
): TaskResponderContract<AppointmentClassificationResult> {
  return {
    taskType: 'medical-appointment-classification',
    taskVersion: '4',
    systemPrompt: taskInstructions,
    requireAllEvidenceCitations: true,
    // Generation must enumerate this batch, including non-medical events. A prose
    // instruction alone does not constrain the generated item count or IDs.
    resultSchema: candidateIds.length
      ? {
          ...taskSchema,
          properties: {
            classifications: {
              ...taskSchema.properties.classifications,
              minItems: candidateIds.length,
              maxItems: candidateIds.length,
              items: {
                ...taskSchema.properties.classifications.items,
                properties: {
                  ...taskSchema.properties.classifications.items.properties,
                  candidateId: { type: 'string', enum: [...candidateIds] },
                },
              },
            },
          },
        }
      : taskSchema,
    correctionInstructionForInvalidResult(reason) {
      // One bounded retry repairs structure; it cannot relax the classification or consent rules.
      if (
        ![
          'A complete classification array is required.',
          'Every supplied candidate must be classified once.',
          'A candidate result did not pass local validation.',
          'A candidate identity was repeated or unknown.',
          'A supplied candidate was omitted.',
          'Every supplied evidence item must be cited.',
        ].includes(reason)
      )
        return undefined;
      return 'Every supplied candidate must appear exactly once, including non_medical and uncertain events. Use only the supplied candidateId values. Include only candidateId and a decision from the supplied enum for each item. The top-level citations must contain every supplied candidateId exactly once. Do not omit events or repeat an ID. Return the corrected complete result.';
    },
    createMessages(input) {
      return [
        {
          role: 'user',
          content: JSON.stringify({
            request: input.request,
            candidates: input.evidence.items.map(item => ({
              candidateId: item.evidenceId,
              event: JSON.parse(item.content) as JsonValue,
            })),
          }),
        },
      ];
    },
    validateResult(value, input) {
      const result = validateAppointmentClassification(
        expandClassificationDecisions(value),
        input,
      );
      if (result.status === 'invalid') onInvalid?.(result.reason);
      return result;
    },
  };
}

export function validateAppointmentClassification(
  value: JsonValue,
  input: TaskResponderInput,
): TaskResultValidation<AppointmentClassificationResult> {
  if (!isRecord(value) || !Array.isArray(value.classifications)) {
    return {
      status: 'invalid',
      reason: 'A complete classification array is required.',
    };
  }
  const expected = new Set(input.evidence.items.map(item => item.evidenceId));
  if (value.classifications.length !== expected.size) {
    return {
      status: 'invalid',
      reason: 'Every supplied candidate must be classified once.',
    };
  }
  const seen = new Set<string>();
  const classifications: AppointmentClassification[] = [];
  for (const item of value.classifications) {
    if (
      isRecord(item) &&
      typeof item.candidateId === 'string' &&
      (!expected.has(item.candidateId) || seen.has(item.candidateId))
    ) {
      return {
        status: 'invalid',
        reason: 'A candidate identity was repeated or unknown.',
      };
    }
    if (
      !isRecord(item) ||
      Object.keys(item).length !== 4 ||
      typeof item.candidateId !== 'string' ||
      !expected.has(item.candidateId) ||
      seen.has(item.candidateId) ||
      !isMedicalRelevance(item.classification) ||
      !isUncertainty(item.uncertainty) ||
      typeof item.reason !== 'string' ||
      item.reason.trim().length === 0 ||
      item.reason.trim().length > 500
    ) {
      return {
        status: 'invalid',
        reason: 'A candidate result did not pass local validation.',
      };
    }
    seen.add(item.candidateId);
    classifications.push({
      candidateId: item.candidateId,
      classification: item.classification,
      reason: item.reason.trim(),
      uncertainty: item.uncertainty,
    });
  }
  if (seen.size !== expected.size) {
    return { status: 'invalid', reason: 'A supplied candidate was omitted.' };
  }
  return { status: 'valid', value: { classifications } };
}

function isRecord(
  value: JsonValue | undefined,
): value is Readonly<Record<string, JsonValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMedicalRelevance(
  value: JsonValue | undefined,
): value is MedicalRelevance {
  return (
    value === 'medical' || value === 'non_medical' || value === 'uncertain'
  );
}

function isUncertainty(
  value: JsonValue | undefined,
): value is ClassificationUncertainty {
  return value === 'low' || value === 'medium' || value === 'high';
}
