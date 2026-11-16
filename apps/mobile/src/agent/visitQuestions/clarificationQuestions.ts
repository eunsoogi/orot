import { t } from '../../i18n';

/** App-owned wording cannot introduce a patient's unrecorded history. The model selects
 * the relevant gaps; a person can revise the resulting questions during review.
 * Prompt, display and exact-pair validation share this one catalog-backed list.
 * The shipped Korean-only catalog must preserve these safety-boundary values verbatim. */
export const clarificationQuestions = [
  {
    questionText: t('nextVisit.clarification.careOptions.question'),
    rationale: t('nextVisit.clarification.careOptions.rationale'),
  },
  {
    questionText: t('nextVisit.clarification.symptomReview.question'),
    rationale: t('nextVisit.clarification.symptomReview.rationale'),
  },
  {
    questionText: t('nextVisit.clarification.testingPurpose.question'),
    rationale: t('nextVisit.clarification.testingPurpose.rationale'),
  },
  {
    questionText: t('nextVisit.clarification.carePlan.question'),
    rationale: t('nextVisit.clarification.carePlan.rationale'),
  },
  {
    questionText: t('nextVisit.clarification.preparationRecords.question'),
    rationale: t('nextVisit.clarification.preparationRecords.rationale'),
  },
  {
    questionText: t('nextVisit.clarification.unconfirmedResults.question'),
    rationale: t('nextVisit.clarification.unconfirmedResults.rationale'),
  },
  {
    questionText: t('nextVisit.clarification.conflictingRecords.question'),
    rationale: t('nextVisit.clarification.conflictingRecords.rationale'),
  },
  {
    questionText: t('nextVisit.clarification.medicationInformation.question'),
    rationale: t('nextVisit.clarification.medicationInformation.rationale'),
  },
  {
    questionText: t('nextVisit.clarification.symptomTiming.question'),
    rationale: t('nextVisit.clarification.symptomTiming.rationale'),
  },
  {
    questionText: t('nextVisit.clarification.visitPreparation.question'),
    rationale: t('nextVisit.clarification.visitPreparation.rationale'),
  },
  {
    questionText: t('nextVisit.clarification.followUp.question'),
    rationale: t('nextVisit.clarification.followUp.rationale'),
  },
  {
    questionText: t('nextVisit.clarification.additionalTesting.question'),
    rationale: t('nextVisit.clarification.additionalTesting.rationale'),
  },
] as const;

export function isKnownClarification(
  questionText: string,
  rationale: string,
): boolean {
  return clarificationQuestions.some(
    item => item.questionText === questionText && item.rationale === rationale,
  );
}

/** A missing or partial search is not proof of a record discrepancy. Keep legacy
 * pairs valid for saved drafts, but offer record reconciliation only for actual conflicts.
 * Conditional clinical questions do not assert symptoms, diagnoses or treatment use. */
export function clarificationQuestionsForEvidence(hasConflicts: boolean) {
  return clarificationQuestions.filter(
    item =>
      item.questionText !==
        t('nextVisit.clarification.unconfirmedResults.question') &&
      (hasConflicts ||
        item.questionText !==
          t('nextVisit.clarification.conflictingRecords.question')),
  );
}
