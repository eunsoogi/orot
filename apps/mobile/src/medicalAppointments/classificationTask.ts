import type { JsonObject, JsonValue } from '@orot/model-runtime';
import type {
  TaskResponderContract,
  TaskResponderInput,
  TaskResultValidation,
} from '@orot/agent-runtime';

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
        required: ['candidateId', 'classification', 'reason', 'uncertainty'],
        properties: {
          candidateId: { type: 'string' },
          classification: { enum: ['medical', 'non_medical', 'uncertain'] },
          reason: { type: 'string', maxLength: 500 },
          uncertainty: { enum: ['low', 'medium', 'high'] },
        },
      },
    },
  },
} as JsonObject;

const taskInstructions = [
  'Classify each supplied upcoming Calendar event only for whether it appears to be a medical appointment.',
  'Use only the supplied event title and time. Do not infer a diagnosis, give health advice, or invent missing details.',
  'Return exactly one item for every candidateId and no others. Use uncertain when the event is ambiguous.',
  'Give a short Korean reason and a low, medium, or high uncertainty rating for each candidate.',
  'Do not request more evidence; return uncertain when the supplied event text is insufficient.',
].join(' ');

/** Builds a bounded responder contract; local validation prevents missing or duplicated candidates. */
export function createAppointmentClassificationTask(): TaskResponderContract<AppointmentClassificationResult> {
  return {
    taskType: 'medical-appointment-classification',
    taskVersion: '1',
    systemPrompt: taskInstructions,
    resultSchema: taskSchema,
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
      return validateAppointmentClassification(value, input);
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
