import { SUMMARY_UNCERTAINTY_REASON } from './summaryUncertainty';
import { summaryPresentationCorrection } from './summaryPresentation';
import { summaryLanguageCorrection } from './summaryLanguage';
import { summaryCoverageCorrection } from './summaryCoverageNotes';
import { summaryFactCorrection } from './summaryFactValidation';

/** Keep correction requests bounded to the current evidence and the rejected field. */
export function summaryCorrection(reason: string): string | undefined {
  if (reason === SUMMARY_UNCERTAINTY_REASON)
    return 'Return uncertaintyNotes as an array of actual limitations written in Korean, or an empty array when none applies. Do not return the old scalar uncertainty field or untranslated placeholders. Keep valid facts and citation IDs unchanged. Do not request new sources.';
  const presentationCorrection = summaryPresentationCorrection(reason);
  if (presentationCorrection) return presentationCorrection;
  const languageCorrection = summaryLanguageCorrection(reason);
  if (languageCorrection) return languageCorrection;
  const coverageCorrection = summaryCoverageCorrection(reason);
  if (coverageCorrection) return coverageCorrection;
  const factCorrection = summaryFactCorrection(reason);
  if (factCorrection) return factCorrection;
  if (reason === 'Keep record facts and medical context separate.')
    return 'Separate personal-record facts and medical context into different sections. Cite personal records for facts and publications for medical context. Use only existing evidence.';
  if (reason === 'Medication registration is not confirmed use.')
    return 'Medication registration alone does not confirm an individual dose. Describe registered medications and explicitly recorded schedules, with any limits on dose confirmation. Use only existing evidence and the specified JSON format.';
  return undefined;
}
