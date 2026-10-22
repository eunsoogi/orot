import type { JsonValue } from '@orot/model-runtime';
import type { TaskResponderInput } from '@orot/agent-runtime';
import type { DiseaseHypothesisAnalysis } from './types';

const marker = /\s*\(([es]\d+)\)|\s*\[([es]\d+)\]/gu;
export const SUMMARY_PRESENTATION_REASONS = {
  citation: 'Keep evidence IDs in citation arrays, not summary prose.',
  contrary: 'A factual summary must not invent opposing evidence.',
} as const;

/** Remove duplicate display markers only when their exact current IDs remain in this section's citation arrays.
 * This precedes fact validation so ID digits cannot masquerade as measured values. Never remap an ID or add prose.
 */
export function normalizeSummarySections(
  sections: JsonValue | undefined,
  input: TaskResponderInput,
) {
  if (!Array.isArray(sections)) return sections;
  const allowed = new Set(input.evidence.items.map(item => item.evidenceId));
  return sections.map(section => {
    if (!section || typeof section !== 'object' || Array.isArray(section))
      return section;
    const bound = new Set([
      ...(Array.isArray(section.supportingEvidence)
        ? section.supportingEvidence
        : []),
      ...(Array.isArray(section.contraryEvidence)
        ? section.contraryEvidence
        : []),
    ]);
    const clean = (text: string) => {
      const withoutMarkers = text.replace(
        marker,
        (whole, a: string, b: string) => {
          const id = a ?? b;
          return allowed.has(id) && bound.has(id) ? '' : whole;
        },
      );
      return withoutMarkers === text ? text : withoutMarkers.trim();
    };
    // Only omission receives defaults. Explicit nulls, placeholders and untranslated text still fail validation.
    return Object.fromEntries(
      Object.entries({ uncertainty: '', missingData: [], ...section }).map(
        ([key, value]) => [
          key,
          ['title', 'summary', 'uncertainty'].includes(key) &&
          typeof value === 'string'
            ? clean(value)
            : key === 'missingData' && Array.isArray(value)
              ? value.map(item =>
                  typeof item === 'string' ? clean(item) : item,
                )
              : value,
        ],
      ),
    );
  });
}

/** Conflicting facts can be narrated with supporting sources; this task does not evaluate disease counter-hypotheses. */
export function summaryPresentationIssue(analysis: DiseaseHypothesisAnalysis) {
  if (analysis.hypotheses.some(item => item.contraryEvidence.length))
    return 'contrary' as const;
  if (
    analysis.hypotheses.some(item =>
      [item.title, item.summary, item.uncertainty, ...item.missingData].some(
        text => /\([es]\d+\)|\[[es]\d+\]/u.test(text),
      ),
    )
  )
    return 'citation' as const;
  return undefined;
}

export function summaryPresentationCorrection(
  reason: string,
): string | undefined {
  if (reason === SUMMARY_PRESENTATION_REASONS.citation)
    return 'Remove inline citation ID markers from prose. Keep exact used IDs in the citation arrays; never invent an ID. Preserve the actual facts.';
  if (reason === SUMMARY_PRESENTATION_REASONS.contrary)
    return 'Return contraryEvidence as an empty array for this factual summary. Describe any supported differing observations as facts with supportingEvidence, not as a disease counter-hypothesis. Preserve facts and exact citations.';
  return undefined;
}
