import type { EvidenceItem, TaskResultValidation } from '@orot/agent-runtime';
import type { DiseaseHypothesisAnalysis } from './types';
import { structuredSummaryFacts } from './summaryFactValidation';
import { t } from '../i18n';

export const SUMMARY_SYMPTOM_COVERAGE_NOTE =
  'no_symptom_entries_in_supplied_records';
const invalidReason =
  'Use only supported, brief supplied-record coverage notes.';

export function summaryCoverageCorrection(reason: string): string | undefined {
  return reason === invalidReason
    ? 'Remove unsupported coverageNotes. Use no_symptom_entries_in_supplied_records only when every supplied personal/memory record is a typed non-symptom record. Keep uncertainty brief and preserve concrete facts and citations.'
    : undefined;
}

/** Coverage is a typed statement about the supplied subset, never a language heuristic or a claim that the app has no records. */
export function applySummaryCoverageNotes(
  analysis: DiseaseHypothesisAnalysis,
  notes: unknown,
  evidence: readonly EvidenceItem[],
): TaskResultValidation<DiseaseHypothesisAnalysis> {
  if (notes === undefined || (Array.isArray(notes) && notes.length === 0))
    return { status: 'valid', value: analysis };
  const invalid = { status: 'invalid' as const, reason: invalidReason };
  if (
    !Array.isArray(notes) ||
    notes.length !== 1 ||
    notes[0] !== SUMMARY_SYMPTOM_COVERAGE_NOTE
  )
    return invalid;
  const clinical = evidence.filter(
    item => item.sourceKind !== 'external_medical',
  );
  const supportedKinds = [
    'medication_definition',
    'medication_assertion',
    'dose_event',
    'health_observation',
    'health_context_quantity',
    'health_context_sleep',
  ];
  // Untyped prose or a symptom entry can contain subjective symptoms, so absence cannot be established from it.
  if (
    !clinical.length ||
    !clinical.every(item => {
      const facts = structuredSummaryFacts(item.content);
      return (
        item.sourceKind === 'personal_record' &&
        facts.length > 0 &&
        facts.every(
          fact =>
            supportedKinds.includes(String(fact.kind)) ||
            (fact.kind === 'health_context_symptoms' && fact.entryCount === 0),
        )
      );
    })
  )
    return invalid;
  const index = analysis.hypotheses.findIndex(section =>
    section.supportingEvidence.some(
      ref => ref.sourceKind === 'personal_record',
    ),
  );
  if (index < 0) return invalid;
  const original = analysis.hypotheses[index]!;
  const note = t('diseaseHypotheses.summaryCoverageNote');
  const uncertainty = original.uncertainty
    ? `${original.uncertainty}\n${note}`
    : note;
  if (uncertainty.length > 500) return invalid;
  return {
    status: 'valid',
    value: {
      ...analysis,
      hypotheses: analysis.hypotheses.map((section, position) =>
        position === index ? { ...section, uncertainty } : section,
      ),
    },
  };
}
