// Each Questions leaf owns complete methods and one 20-minute preparation, execution and cleanup budget.
const questionFixture = { profiles: ['fixtures'], suites: ['questions'], minutes: 20 };

export const questionCohorts = {
  questions: questionFixture,
  'questions-review': {
    ...questionFixture,
    classes: ['NextVisitReviewUITests', 'VisitQuestionConsentUITests'],
  },
  'questions-conversation': {
    ...questionFixture,
    // Keep the composer/appearance journey intact with its own preparation and artifact budget.
    cases: ['KeyboardSafeAreaUITests/testConversationOutputComposerAndSwipeUndoAcrossAppearances'],
  },
  'questions-accessibility': {
    ...questionFixture,
    // These standalone methods retain keyboard, large-text, gesture and cleanup boundaries.
    cases: [
      'KeyboardSafeAreaUITests/testKoreanPrimaryActionRemainsReachableWithLargeTextAndKeyboardOpen',
      'KeyboardSafeAreaUITests/testConversationLongTitlesAndFullSwipeAcrossTextSizes',
    ],
  },
  'questions-summary': {
    ...questionFixture,
    // Complete persistence/appearance journeys need independent whole-job preparation and cleanup budgets.
    cases: [
      'SummaryAndLiteratureUITests/testSavedSummaryRestoresAfterRelaunchAndHistoryReadRecoversAcrossAppearances',
    ],
  },
  'questions-literature': {
    ...questionFixture,
    cases: [
      'SummaryAndLiteratureUITests/testLiteratureConsentSearchRecoveryAndCancelledReadAcrossAppearances',
    ],
  },
};
