import type { JsonObject } from '@orot/model-runtime';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';

/** App-owned concepts keep automatic public searches free of source text and identifiers. */
const concepts = {
  general_health: 'general health',
  blood_pressure: 'blood pressure',
  heart_rate: 'heart rate',
  heart_rhythm: 'heart rhythm',
  physical_activity: 'physical activity',
  walking: 'walking',
  sleep: 'sleep',
  adult_sleep_duration: 'sleep duration adults',
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
        'Choose public topics: the app constructs the query without record values.',
    },
  },
  required: ['topics'],
};

export function parsePublicWebQuery(value: unknown): JsonObject | undefined {
  const labels = publicMedicalTopicLabels(value);
  return labels ? { query: prefix + labels.join('; ') + suffix } : undefined;
}

/** Convert only the closed topic vocabulary to public search terms. */
export function publicMedicalTopicLabels(
  value: unknown,
): readonly string[] | undefined {
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
    return labels;
  }
  return undefined;
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
  return isControlledPublicWebQuery(message.content);
}

/** Only app-constructed topic queries are known not to contain private record text. */
export function isControlledPublicWebQuery(query: string): boolean {
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
