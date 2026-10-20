import type { JsonObject, JsonValue } from '@orot/model-runtime';
import type { TaskResponderInput } from '@orot/agent-runtime';
import { structuredSummaryFacts } from './summaryFactValidation';
import { canPreviewDiseaseHypothesisSummary } from './resultValidation';
import { computedTopicChoices } from './computedTopicChoices';
import { computedSummaryLimitations } from './computedSummaryLimitations';
import {
  renderStatisticChoices,
  statisticChoiceSchema,
  statisticSourcePeriod,
  type StatisticChoice,
} from './computedStatisticChoice';

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
  const topics: {
    id: string;
    title: string;
    choices: StatisticChoice[];
    period?: string;
    limitations: string[];
  }[] = [];
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
      if (meaningful) {
        const choices = computedTopicChoices(value);
        if (!choices.length) return;
        topics.push({
          id: item.evidenceId,
          title: titles[value.topic]!,
          choices,
          period: statisticSourcePeriod(value),
          limitations: computedSummaryLimitations(value),
        });
      }
    } catch {
      return;
    }
  }
  return topics.length ? topics : undefined;
}

/** Every source and meaningful series has a required selector. The model chooses
 * the statistic; the app binds original values, role labels and citations before normal validation. */
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
          topics.map(topic => [topic.id, statisticChoiceSchema(topic.choices)]),
        ),
      },
      coverageNotes: (base.properties as JsonObject).coverageNotes!,
    },
  };
}

/** This is the declared generated-selection contract, not a fallback for rejected prose.
 * Unknown/missing selections fail before any source-bound summary is persisted. */
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
    const rendered = renderStatisticChoices(summaries[topic.id], topic.choices);
    if (!rendered) return;
    const text = [topic.period, rendered].filter(Boolean).join('\n');
    if (text.length > 1200) return;
    sections.push({
      title: topic.title,
      summary: text,
      supportingEvidence: [topic.id],
      contraryEvidence: [],
      uncertaintyNotes: topic.limitations,
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

/** Selector prefixes cannot be interpreted as prose. Only complete selections can
 * project source-bound facts; ordinary final validation still gates acceptance. */
export function projectAppleRecordSummaries(
  raw: string,
  input: TaskResponderInput,
): string | undefined {
  try {
    const envelope: unknown = JSON.parse(raw);
    if (
      !object(envelope) ||
      !object(envelope.value) ||
      !object(envelope.value.recordSummaries)
    )
      return;
    // Incomplete selector JSON has nothing readable yet; do not rebuild calendar
    // scopes and rendered facts for every streamed prefix.
    const topics = appleRecordTopics(input);
    if (!topics) return;
    const summaries = envelope.value.recordSummaries;
    const texts = topics.map(topic => {
      const text = renderStatisticChoices(summaries[topic.id], topic.choices);
      return text
        ? [topic.period, text, ...topic.limitations].filter(Boolean).join('\n')
        : undefined;
    });
    if (
      texts.some(
        text =>
          !text ||
          text.length > 1200 ||
          !canPreviewDiseaseHypothesisSummary(text),
      )
    )
      return;
    return texts.join('\n\n');
  } catch {
    return;
  }
}
