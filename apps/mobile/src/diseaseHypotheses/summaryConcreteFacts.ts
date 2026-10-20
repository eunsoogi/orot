import type { DiseaseHypothesisAnalysis } from './types';

type Fact = Record<string, unknown>;
type Anchors = { texts: string[]; numbers: number[] };
type Source = { evidenceId: string; facts: readonly Fact[] };
type MissingTopic =
  | 'facts_medications'
  | 'facts_pressure'
  | 'facts_heart_rate'
  | 'facts_body_mass'
  | 'facts_activity'
  | 'facts_other_quantity'
  | 'facts_sleep';

/** Map only known concepts to closed codes; a custom concept must never become a diagnostic token. */
function missingTopic(topic: string): MissingTopic {
  if (topic === 'medications') return 'facts_medications';
  if (topic === 'sleep') return 'facts_sleep';
  switch (topic.toLowerCase()) {
    case 'quantity:blood pressure systolic':
    case 'quantity:blood pressure diastolic':
    case 'quantity:blood_pressure_systolic':
    case 'quantity:blood_pressure_diastolic':
      return 'facts_pressure';
    case 'quantity:heart_rate':
      return 'facts_heart_rate';
    case 'quantity:body_mass':
    case 'quantity:weight':
      return 'facts_body_mass';
    case 'quantity:step_count':
      return 'facts_activity';
    default:
      return 'facts_other_quantity';
  }
}
const normalize = (text: string) =>
  text.normalize('NFKC').replace(/\s/gu, '').toLowerCase();
const object = (value: unknown): value is Fact =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const numbers = (text: string) =>
  (text.replace(/(?<=\d),(?=\d)/gu, '').match(/-?\d+(?:\.\d+)?/gu) ?? []).map(
    Number,
  );
const matches = (anchor: Anchors, text: string) =>
  anchor.texts.some(value => normalize(text).includes(normalize(value))) ||
  anchor.numbers.some(value => numbers(text).includes(value));

function anchorsFor(facts: readonly Fact[]) {
  const topics = new Map<string, Anchors>();
  const add = (topic: string, text?: string, number?: number) => {
    const anchors = topics.get(topic) ?? { texts: [], numbers: [] };
    if (text) anchors.texts.push(text);
    if (number !== undefined) anchors.numbers.push(number);
    topics.set(topic, anchors);
  };
  let suppliedUnit = false;
  for (const fact of facts) {
    if (typeof fact.displayText === 'string')
      add('medications', fact.displayText);
    if (typeof fact.medicationName === 'string')
      add('medications', fact.medicationName);
    if (
      object(fact.value) &&
      fact.value.kind === 'quantity' &&
      typeof fact.value.amount === 'number'
    ) {
      add(`quantity:${String(fact.concept)}`, undefined, fact.value.amount);
      suppliedUnit ||=
        typeof fact.value.unit === 'string' && fact.value.unit.length > 0;
    }
    if (
      object(fact.sourceSemantics) &&
      typeof fact.sourceSemantics.sleepStage === 'string'
    ) {
      const stage = fact.sourceSemantics.sleepStage;
      add(
        'sleep',
        stage.includes('미지정') ? '미지정' : stage.replace(/\s*수면/u, ''),
      );
    }
  }
  return {
    topics: [...topics].map(([topic, anchors]) => ({
      ...anchors,
      issue: missingTopic(topic),
    })),
    suppliedUnit,
  };
}

/** Check coverage across sections citing the same source; a grouped measurement may be explained by concept. */
export function summaryConcreteIssue(
  analysis: DiseaseHypothesisAnalysis,
  sources: readonly Source[],
): MissingTopic | 'facts_placeholder' | 'units' | undefined {
  const hasConcreteFact = new Set<number>();
  const needsConcreteFact = new Set<number>();
  for (const source of sources) {
    const sections = analysis.hypotheses
      .map((section, index) => ({ section, index }))
      .filter(({ section }) =>
        section.supportingEvidence.some(
          ref => ref.evidenceId === source.evidenceId,
        ),
      );
    if (!sections.length) continue;
    const { topics, suppliedUnit } = anchorsFor(source.facts);
    for (const { section, index } of sections) {
      if (topics.length) needsConcreteFact.add(index);
      if (topics.some(topic => matches(topic, section.summary)))
        hasConcreteFact.add(index);
      if (
        suppliedUnit &&
        /단위.{0,20}(?:없|않|불명|미제공)/u.test(
          [section.summary, section.uncertainty, ...section.missingData].join(
            ' ',
          ),
        )
      )
        return 'units';
    }
    const combined = sections.map(({ section }) => section.summary).join(' ');
    const missing = topics.find(topic => !matches(topic, combined));
    if (missing) return missing.issue;
  }
  // Another section's valid facts must not make an empty heading publishable.
  if ([...needsConcreteFact].some(index => !hasConcreteFact.has(index)))
    return 'facts_placeholder';
  return undefined;
}
