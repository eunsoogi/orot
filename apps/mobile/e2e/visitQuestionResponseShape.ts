import type { LanguageModelResponse } from '@orot/model-runtime';

type Kind =
  'missing' | 'null' | 'string' | 'number' | 'boolean' | 'object' | 'array';
const kind = (value: unknown): Kind =>
  value === undefined
    ? 'missing'
    : value === null
      ? 'null'
      : Array.isArray(value)
        ? 'array'
        : typeof value === 'string'
          ? 'string'
          : typeof value === 'number'
            ? 'number'
            : typeof value === 'boolean'
              ? 'boolean'
              : 'object';
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const arrayShape = (value: unknown) => ({
  type: kind(value),
  count: Array.isArray(value) ? value.length : null,
  elementTypes: Array.isArray(value) ? [...new Set(value.map(kind))] : [],
});

/** Report only closed field names, types and counts; never emit model strings or identifiers. */
export function visitQuestionResponseShape(response: LanguageModelResponse) {
  if (response.finishReason !== 'complete' || response.toolCalls.length)
    return { stage: 'nonfinal' };
  let decoded: unknown = response.structuredOutput;
  if (decoded === undefined) {
    try {
      decoded = JSON.parse(response.text);
    } catch {
      return { stage: 'unparseable' };
    }
  }
  const envelope = object(decoded);
  const value = object(envelope.value);
  const questions = Array.isArray(value.questions) ? value.questions : [];
  return {
    stage: 'final',
    envelope: kind(decoded),
    citations: arrayShape(envelope.citations),
    value: kind(envelope.value),
    questions: arrayShape(value.questions),
    questionFields: questions.slice(0, 5).map(item => {
      const entry = object(item);
      return {
        type: kind(item),
        questionText: kind(entry.questionText),
        rationale: kind(entry.rationale),
        priority: kind(entry.priority),
        evidenceIds: arrayShape(entry.evidenceIds),
        extraCount: Object.keys(entry).filter(
          key =>
            !['questionText', 'rationale', 'priority', 'evidenceIds'].includes(
              key,
            ),
        ).length,
      };
    }),
    message: kind(value.message),
    valueExtraCount: Object.keys(value).filter(
      key => !['status', 'questions', 'message'].includes(key),
    ).length,
    envelopeExtraCount: Object.keys(envelope).filter(
      key => !['type', 'value', 'citations'].includes(key),
    ).length,
  };
}
