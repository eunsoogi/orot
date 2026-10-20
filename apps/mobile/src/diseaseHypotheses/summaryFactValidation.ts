import type { EvidenceItem } from '@orot/agent-runtime';
import type { DiseaseHypothesisAnalysis } from './types';
import { summaryConcreteIssue } from './summaryConcreteFacts';
import { summarySleepDurationMismatch } from './summarySleepDuration';
import { summaryPeriodFacts } from './summaryPeriodFacts';
import { summaryStatisticRoleIssue } from './summaryStatisticRoles';

type Fact = Record<string, unknown>;
function object(value: unknown): value is Fact {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Decode only app-authored structured evidence; arbitrary source prose is never treated as JSON instructions. */
export function structuredSummaryFacts(content: string): readonly Fact[] {
  const match =
    /^(health_context|health_overview|health_observation|medication_definition|medication_assertion|dose_event|symptom_entry):\s*/u.exec(
      content,
    );
  if (!match) return [];
  try {
    const [json, semantics] = content
      .slice(match[0].length)
      .split('\nsourceSemantics: ');
    const value: unknown = JSON.parse(json!);
    if (!object(value)) return [];
    if (match[1] === 'health_context') return summaryPeriodFacts(value);
    if (match[1] === 'health_overview')
      return Array.isArray(value.records) ? value.records.filter(object) : [];
    return [
      {
        ...value,
        kind: match[1],
        ...(semantics
          ? { sourceSemantics: JSON.parse(semantics) as unknown }
          : {}),
      },
    ];
  } catch {
    return [];
  }
}

export const SUMMARY_FACT_REASONS = {
  facts: 'Include concrete facts from each cited record topic.',
  facts_medications: 'Include saved medication names from the cited records.',
  facts_pressure:
    'Include recorded blood-pressure amounts and units from the cited records.',
  facts_heart_rate:
    'Include recorded heart-rate amounts and units from the cited records.',
  facts_body_mass:
    'Include recorded body-mass amounts and units from the cited records.',
  facts_activity: 'Include recorded activity counts from the cited records.',
  facts_other_quantity:
    'Include the measured amounts and units from the cited records.',
  facts_sleep: 'Include the decoded sleep stages from the cited records.',
  facts_placeholder:
    'Replace empty section headings with cited concrete facts.',
  units:
    'Do not claim quantity units are missing when cited records supply them.',
  medication: 'Medication registration is not confirmed use.',
  prescription:
    'A medication catalog schedule does not establish prescription status.',
  sleep_count: 'A categorical sleep stage is not an episode count.',
  sleep_duration:
    'The sleep duration does not match the cited individual interval.',
  step_unit: 'Step counts are measured in steps, not occurrences.',
  statistic_roles:
    'Keep observation sample counts separate from measured amounts.',
  sleep_coverage:
    'A calendar-day sleep aggregate does not establish absent complete-night records.',
  missing:
    'A factual registration summary does not require missing dose completion or schedule details.',
} as const;

export function summaryFactCorrection(reason: string): string | undefined {
  if (reason === SUMMARY_FACT_REASONS.statistic_roles)
    return 'Use only sampleCount for the number of observation samples. A latest amount, minimum, maximum or mean is a measured quantity, never a sample count. Preserve each sensor series and exact citations.';
  if (reason === SUMMARY_FACT_REASONS.sleep_coverage)
    return 'State that calendar-day sleep union is not a complete-night total. It establishes neither presence nor absence of complete-night records. Do not claim those records are missing. Keep supplied sleep amounts, coverage and citations.';
  if (reason === SUMMARY_FACT_REASONS.sleep_duration)
    return 'Use the supplied intervalDurationDisplay for each cited sleep stage. Preserve its original individual interval and do not recalculate or invent a nightly total. Keep other facts and exact citations unchanged.';
  if (reason === SUMMARY_FACT_REASONS.step_unit)
    return 'State step_count amounts using the Korean unit for steps, not occurrences. Preserve the original amounts, source times, other record topics and citation IDs.';
  if (reason === SUMMARY_FACT_REASONS.prescription)
    return 'Describe the cited medications as registered in Health. hasSchedule indicates only whether a medication schedule is registered; it does not establish prescribed or not prescribed. Keep all other concrete topics and exact citation IDs. Do not invent prescription status or remove available facts.';
  if (reason === SUMMARY_FACT_REASONS.sleep_count)
    return 'Use the decoded sleep stage and the supplied individual interval. A HealthKit sleep category code is not a number of occurrences. Express intervalDurationSeconds in readable minutes and seconds; do not count sleep episodes or infer a nightly total. Preserve other facts and citation IDs.';
  if (reason === SUMMARY_FACT_REASONS.facts_placeholder)
    return 'Every section citing personal_record must state a concrete fact from that exact source. A general publication explanation must cite external_medical sources only, never personal records. Remove duplicate sections, empty headings and standalone symptom-coverage limitations. Keep the concrete facts for every available record topic. Use optional coverageNotes for a supported supplied-subset symptom limitation; never invent symptoms or imply the app lacks records.';
  const topic = Object.entries(SUMMARY_FACT_REASONS).find(
    ([key, value]) => key.startsWith('facts_') && value === reason,
  );
  if (topic)
    return `${topic[1]} Summarize across sections citing that exact source. Use only the existing evidence and preserve exact citations; do not invent values or repeat every fact in every section.`;
  if (reason === SUMMARY_FACT_REASONS.facts)
    return 'Replace placeholder summaries with actual medication names, measurement values and units, activity counts and sleep stages from every cited topic. Keep exact citations. Use only the already returned evidence; do not invent facts.';
  if (reason === SUMMARY_FACT_REASONS.units)
    return 'Use the normalized quantity amount and unit supplied in the cited records. Missing source-display formatting does not make those fields unavailable. Remove unsupported uncertainty and use only the existing evidence.';
  if (reason === SUMMARY_FACT_REASONS.missing)
    return 'Summarize registered medication names and whether a schedule is registered. Distinguish individual dose completion, but do not require dose completion or schedule details to state those registration facts. Remove unnecessary missingData.';
  return undefined;
}

const normalize = (text: string) =>
  text.normalize('NFKC').replace(/\s/gu, '').toLowerCase();

/** Citation presence alone cannot approve an empty heading or deny fields that the source actually supplies. */
export function summaryFactIssue(
  analysis: DiseaseHypothesisAnalysis,
  evidence: readonly EvidenceItem[],
  onMedicationIssue?: (
    issue: 'completion' | 'unknown' | 'missing_data',
  ) => void,
  onEmptySection?: (index: number) => void,
) {
  for (const section of analysis.hypotheses) {
    const cited = evidence.filter(
      item =>
        item.sourceKind === 'personal_record' &&
        section.supportingEvidence.some(
          ref => ref.evidenceId === item.evidenceId,
        ),
    );
    const facts = cited.flatMap(item => structuredSummaryFacts(item.content));
    if (!facts.length) continue;
    const roleIssue = summaryStatisticRoleIssue(
      [
        section.title,
        section.summary,
        section.uncertainty,
        ...section.missingData,
      ].join('\n'),
      facts,
    );
    if (roleIssue) return roleIssue;
    if (summarySleepDurationMismatch(section.summary, facts))
      return 'sleep_duration' as const;
    const medicationDefinitions = facts.filter(
      fact => fact.kind === 'medication_definition',
    );
    const prose = normalize([section.title, section.summary].join(' '));
    if (
      facts.some(
        fact =>
          (fact.kind === 'health_observation' ||
            fact.kind === 'health_context_quantity') &&
          fact.concept === 'step_count',
      ) &&
      /걸음(?:수)?(?:는|은|이|가)?[:=]?[\d,.]+회/u.test(prose)
    )
      return 'step_unit' as const;
    // Catalog registration and schedule presence cannot establish a positive or negative prescription assertion.
    // This bounded predicate check is conservative; it is not a general clinical fact verifier.
    if (
      medicationDefinitions.length &&
      !facts.some(
        fact =>
          fact.kind === 'medication_assertion' &&
          fact.assertionKind === 'prescribed',
      ) &&
      /처방(?:됨|되지않|되었|됐|받|된약|되어있|입니다|이에요|임)/u.test(prose)
    )
      return 'prescription' as const;
    if (
      facts.some(
        fact =>
          object(fact.sourceSemantics) &&
          fact.sourceSemantics.intervalScope ===
            'single_sample_not_nightly_total',
      ) &&
      /(?:수면|단계)\d+(?:회|번)/u.test(prose)
    )
      return 'sleep_count' as const;
    const doseCompleted = facts.some(
      fact =>
        fact.kind === 'dose_event' &&
        (fact.eventKind === 'taken' ||
          fact.eventKind === 'administered' ||
          fact.observationStatus === 'taken'),
    );
    // Reject explicit affirmative predicates, not a completion noun quoted in a limitation.
    // This conservative language heuristic supplements exact citations; it is not a clinical fact verifier.
    const unsupportedCompletion = section.summary
      .split(/[.!?。\n]/u)
      .some(clause => {
        const text = normalize(clause);
        return /(?:복용|복약|투약)(?:(?:했|하였)(?:어요|습니다|다)|(?:완료|확인)(?:기록)?(?:을|를|이|가)?(?:확인)?(?:(?:했|하였|됐|되었)?(?:어요|습니다|다)|됨|입니다|이에요|예요|$))/u.test(
          text,
        );
      });
    if (
      medicationDefinitions.length > 0 &&
      !doseCompleted &&
      unsupportedCompletion
    ) {
      onMedicationIssue?.('completion');
      return 'medication' as const;
    }
    const registrationProse = [section.summary, section.uncertainty].join(' ');
    if (
      medicationDefinitions.length &&
      /(?:복용|복약)\s*여부/u.test(registrationProse) &&
      !/개별|매회|완료/u.test(registrationProse)
    ) {
      onMedicationIssue?.('unknown');
      return 'missing' as const;
    }
    if (
      medicationDefinitions.length &&
      section.missingData.some(text =>
        /^(?:복용|복약)\s*(?:여부|일정)[.!?]?$/u.test(text.trim()),
      )
    ) {
      onMedicationIssue?.('missing_data');
      return 'missing' as const;
    }
  }
  return summaryConcreteIssue(
    analysis,
    evidence
      .filter(item => item.sourceKind === 'personal_record')
      .map(item => ({
        evidenceId: item.evidenceId,
        facts: structuredSummaryFacts(item.content),
      })),
    onEmptySection,
  );
}
