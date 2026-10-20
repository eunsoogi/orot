import type { JsonObject, JsonValue } from '@orot/model-runtime';
import type { TaskResponderInput } from '@orot/agent-runtime';
import { extractPartialJsonStringAtPath } from '@orot/agent-runtime';
import { structuredSummaryFacts } from './summaryFactValidation';
import { canPreviewDiseaseHypothesisSummary } from './resultValidation';

const titles: Record<string, string> = {
  medications: '복용약',
  measurements: '건강 측정',
  activity: '활동 기록',
  sleep: '수면 기록',
  symptoms: '증상 기록',
};
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Required fields need an actual supplied anchor, never merely a decoded category tag. */
function meaningfulFact(fact: Record<string, unknown>): boolean {
  if (fact.kind === 'health_context_quantity')
    return (
      Array.isArray(fact.amounts) &&
      fact.amounts.some(
        amount => typeof amount === 'number' && Number.isFinite(amount),
      )
    );
  if (fact.kind === 'health_context_symptoms')
    return typeof fact.entryCount === 'number' && fact.entryCount > 0;
  if (fact.kind === 'health_context_sleep')
    return typeof fact.minutes === 'number' && Number.isFinite(fact.minutes);
  if (
    fact.kind === 'medication_definition' ||
    fact.kind === 'medication_assertion'
  )
    return (
      typeof fact.medicationName === 'string' &&
      fact.medicationName.trim().length > 0
    );
  return false;
}

/** Use required source-bound fields only for a final group of app-computed topics.
 * Empty topics need no fabricated section. Unknown/raw formats retain the original task contract. */
export function appleRecordTopics(input: TaskResponderInput) {
  if (
    input.resultPartition?.sourceKind !== 'personal_record' ||
    !input.evidence.items.length
  )
    return;
  const topics: { id: string; title: string }[] = [];
  for (const item of input.evidence.items) {
    if (
      item.sourceKind !== 'personal_record' ||
      !item.content.startsWith('health_context: ')
    )
      return;
    try {
      const value: unknown = JSON.parse(
        item.content.slice('health_context: '.length),
      );
      if (
        !object(value) ||
        typeof value.topic !== 'string' ||
        !Object.prototype.hasOwnProperty.call(titles, value.topic)
      )
        return;
      const meaningful = structuredSummaryFacts(item.content).some(
        meaningfulFact,
      );
      if (meaningful)
        topics.push({ id: item.evidenceId, title: titles[value.topic]! });
    } catch {
      return;
    }
  }
  return topics.length ? topics : undefined;
}

/** A short string per required source avoids repeating a full section schema or letting
 * optional array entries silently omit an available topic. All facts still pass normal validation. */
export function appleRecordSummarySchema(
  input: TaskResponderInput,
  base: JsonObject,
): JsonObject | undefined {
  const topics = appleRecordTopics(input);
  if (!topics) return;
  return {
    type: 'object',
    required: ['recordSummaries'],
    additionalProperties: false,
    properties: {
      recordSummaries: {
        type: 'object',
        required: topics.map(topic => topic.id),
        additionalProperties: false,
        properties: Object.fromEntries(
          topics.map(topic => [
            topic.id,
            {
              type: 'string',
              minLength: 1,
              maxLength: 1200,
              description: `Korean factual summary for ${topic.title}. Include supplied concrete facts and actual limitations from this source only. For measurements include every supplied quantity concept; preserve amounts, units and coverage.`,
            },
          ]),
        ),
      },
      coverageNotes: (base.properties as JsonObject).coverageNotes!,
    },
  };
}

/** Source keys select citations locally; model text cannot redirect a topic to another record.
 * Interpretive limitations remain in each summary's prose; optional verified coverage notes survive. */
export function normalizeAppleRecordSummary(
  value: JsonValue,
  input: TaskResponderInput,
): JsonValue | undefined {
  const topics = appleRecordTopics(input);
  if (!topics) return value;
  if (
    !object(value) ||
    Object.keys(value).some(
      key => !['recordSummaries', 'coverageNotes'].includes(key),
    ) ||
    !object(value.recordSummaries)
  )
    return;
  const summaries = value.recordSummaries;
  const ids = topics.map(topic => topic.id);
  if (
    Object.keys(summaries).length !== ids.length ||
    Object.keys(summaries).some(id => !ids.includes(id))
  )
    return;
  const sections = [];
  for (const topic of topics) {
    const text = summaries[topic.id];
    if (typeof text !== 'string' || !text.trim() || text.length > 1200) return;
    sections.push({
      title: topic.title,
      summary: text,
      supportingEvidence: [topic.id],
      contraryEvidence: [],
      uncertaintyNotes: [],
      missingData: [],
    });
  }
  return {
    sections,
    ...(value.coverageNotes !== undefined
      ? { coverageNotes: value.coverageNotes as JsonValue }
      : {}),
  };
}

/** Project only readable tentative prose, never the required JSON field names or source IDs. */
export function projectAppleRecordSummaries(
  raw: string,
  input: TaskResponderInput,
): string | undefined {
  const topics = appleRecordTopics(input);
  if (!topics) return;
  const texts = topics
    .map(topic =>
      extractPartialJsonStringAtPath(raw, [
        'value',
        'recordSummaries',
        topic.id,
      ]),
    )
    .filter(
      (text): text is string =>
        typeof text === 'string' && canPreviewDiseaseHypothesisSummary(text),
    );
  return texts.length ? texts.join('\n\n') : undefined;
}
