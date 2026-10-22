import type { JsonObject } from '@orot/model-runtime';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';

/** Only these app-owned public concepts qualify for reusable search permission.
 * Free-form searches remain available, but require review for each request. */
const concepts = {
  blood_pressure: 'blood pressure',
  heart_rate: 'heart rate',
  heart_rhythm: 'heart rhythm',
  physical_activity: 'physical activity',
  walking: 'walking',
  sleep: 'sleep',
  medication_adherence: 'medication adherence',
  medication_effects: 'medication effects',
  nutrition: 'nutrition',
  hydration: 'hydration',
  blood_glucose: 'blood glucose',
  oxygen_saturation: 'oxygen saturation',
  body_weight: 'body weight',
  body_temperature: 'body temperature',
  respiratory_rate: 'respiratory rate',
  stress: 'stress',
  pain: 'pain',
  fatigue: 'fatigue',
  dizziness: 'dizziness',
  headache: 'headache',
} as const;
const prefix = 'General public health information about: ';
const suffix =
  '. Guidelines, associations, possible explanations and limitations.';

export const publicWebQuerySchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    topics: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      uniqueItems: true,
      items: { type: 'string', enum: Object.keys(concepts) },
      description:
        'Prefer public topics: the app constructs the query without record values. Choose topics OR query, never both.',
    },
    query: {
      type: 'string',
      minLength: 1,
      maxLength: 240,
      description:
        'Optional specific public query when topics are insufficient. Requires explicit per-request review. Exclude identifiers, private measurements, dates, record text and conversation history.',
    },
  },
  anyOf: [{ required: ['topics'] }, { required: ['query'] }],
};

export function parsePublicWebQuery(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1) return undefined;
  if ('topics' in input) {
    if (
      !Array.isArray(input.topics) ||
      input.topics.length < 1 ||
      input.topics.length > 4 ||
      input.topics.some(
        topic => typeof topic !== 'string' || !Object.hasOwn(concepts, topic),
      ) ||
      new Set(input.topics).size !== input.topics.length
    )
      return undefined;
    const labels = input.topics.map(
      topic => concepts[topic as keyof typeof concepts],
    );
    return { query: prefix + labels.join('; ') + suffix };
  }
  if (typeof input.query !== 'string') return undefined;
  const query = input.query.trim();
  return query &&
    [...query].length <= 240 &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(query)
    ? { query }
    : undefined;
}

/** Validate the actual outbound bytes, not a model-supplied assertion of privacy.
 * Nothing outside the finite app vocabulary can inherit a topic permission. */
export function isReusablePublicWebQuery(
  request: OutboundProcessingRequest,
): boolean {
  if (
    request.consentScope?.policyVersion !== 'controlled-public-topics-v2' ||
    request.payload.messages.length !== 1
  )
    return false;
  const message = request.payload.messages[0];
  if (message?.role !== 'user' || typeof message.content !== 'string')
    return false;
  const query = message.content;
  if (!query.startsWith(prefix) || !query.endsWith(suffix)) return false;
  const labels = query.slice(prefix.length, -suffix.length).split('; ');
  return (
    labels.length >= 1 &&
    labels.length <= 4 &&
    new Set(labels).size === labels.length &&
    labels.every(label =>
      Object.values(concepts).some(known => label === known),
    )
  );
}
