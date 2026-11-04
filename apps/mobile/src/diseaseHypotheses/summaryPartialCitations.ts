import type { JsonValue } from '@orot/model-runtime';
import type {
  TaskResponderInput,
  TaskResultValidation,
} from '@orot/agent-runtime';
import { validateDiseaseHypothesisResult } from './resultValidation';
import {
  MAX_SYMPTOM_SUMMARY_SECTIONS,
  type DiseaseHypothesisAnalysis,
} from './types';
import { summaryFactIssue } from './summaryFactValidation';

/** Drop whole sections with invalid citations or locally detectable factual errors without repairing them. */
export function discardUncitedSummarySections(
  sections: JsonValue | undefined,
  input: TaskResponderInput,
) {
  if (
    !Array.isArray(sections) ||
    !sections.length ||
    sections.length > MAX_SYMPTOM_SUMMARY_SECTIONS
  )
    return { sections, omitted: false };
  let omitted = false;
  const retained = sections.filter(section => {
    let failure: string | undefined;
    const validation = validateDiseaseHypothesisResult(
      { hypotheses: [section] },
      input,
      {
        allowEmptyUncertainty: true,
        onInvalid: code => {
          failure = code;
        },
      },
    );
    if (failure === 'citations') {
      omitted = true;
      return false;
    }
    if (validation.status !== 'valid') return true;
    // Coverage checks can require several sections together. Only independent
    // section-level contradictions justify removing a section here.
    const issue = summaryFactIssue(validation.value, input.evidence.items);
    if (
      !issue ||
      ![
        'medication',
        'prescription',
        'sleep_count',
        'sleep_duration',
        'step_unit',
        'statistic_roles',
        'sleep_coverage',
        'units',
        'missing',
      ].includes(issue)
    )
      return true;
    omitted = true;
    return false;
  });
  // With no usable section, keep the original for the normal citation failure and diagnostics.
  return retained.length
    ? { sections: retained, omitted }
    : { sections, omitted: false };
}

export const OMITTED_SUMMARY_CITATION_NOTE =
  '일부 내용은 근거를 확인할 수 없어 제외했어요.';

/** Keep prior limitations intact and disclose that some generated content was omitted. */
export function noteOmittedSummaryCitations(
  analysis: DiseaseHypothesisAnalysis,
): TaskResultValidation<DiseaseHypothesisAnalysis> {
  return {
    status: 'valid',
    value: {
      ...analysis,
      omittedUnsupportedContent: true,
      presentation: 'symptom_summary',
    },
  };
}
