import type { DiseaseHypothesisAnalysis } from './types';

export const SUMMARY_LANGUAGE_REASONS = {
  summary: 'The summary field must be written in Korean.',
  uncertainty: 'The uncertainty field must be written in Korean.',
  missing_data: 'The missingData field must be written in Korean.',
} as const;

/** Target the rejected field; do not fill an optional limitation with invented Korean copy. */
export function summaryLanguageCorrection(reason: string): string | undefined {
  const field = (
    Object.keys(
      SUMMARY_LANGUAGE_REASONS,
    ) as (keyof typeof SUMMARY_LANGUAGE_REASONS)[]
  ).find(key => SUMMARY_LANGUAGE_REASONS[key] === reason);
  if (!field) return undefined;
  const instruction =
    field === 'uncertainty'
      ? 'Return uncertaintyNotes as an array of actual interpretive limitations written in Korean. If none applies, omit uncertaintyNotes or use an empty array. Do not return the scalar uncertainty field or English placeholders. Never invent a limitation.'
      : field === 'missing_data'
        ? 'Write actual missingData in Korean. If no information is required, use an empty array; never invent a missing item.'
        : 'Write summary as concise Korean prose using only the supplied facts.';
  return (
    instruction +
    ' Keep valid facts and citation IDs unchanged. Return the complete specified JSON response. Do not request new sources.'
  );
}

/** Classify the first untranslated field without returning or logging private model prose. */
export function summaryLanguageIssue(analysis: DiseaseHypothesisAnalysis):
  | {
      field: 'summary' | 'uncertainty' | 'missing_data';
      shape: ReturnType<typeof summaryLanguageShape>;
    }
  | undefined {
  const untranslated = (text: string) =>
    text.length > 0 && !/[가-힣]/u.test(text);
  for (const item of analysis.hypotheses) {
    if (untranslated(item.summary))
      return { field: 'summary', shape: summaryLanguageShape(item.summary) };
    if (untranslated(item.uncertainty))
      return {
        field: 'uncertainty',
        shape: summaryLanguageShape(item.uncertainty),
      };
    const missing = item.missingData.find(untranslated);
    if (missing !== undefined)
      return { field: 'missing_data', shape: summaryLanguageShape(missing) };
  }
  return undefined;
}

/** Observation only: token-like units and placeholders remain rejected until their meaning is established. */
export function summaryLanguageShape(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return 'blank' as const;
  if (/^[\p{P}\p{S}\s]+$/u.test(trimmed)) return 'symbols' as const;
  if (/^[\d\p{P}\p{S}\s]+$/u.test(trimmed)) return 'numeric' as const;
  if (/[A-Za-z]/u.test(trimmed)) {
    if (/\d/u.test(trimmed)) return 'latin_numbers' as const;
    return /\s/u.test(trimmed)
      ? ('latin_phrase' as const)
      : ('latin_token' as const);
  }
  return 'other' as const;
}
