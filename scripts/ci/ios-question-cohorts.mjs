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
    // Keep native conversation journeys together with their own preparation and artifact budget.
    cases: [
      'AssistantAppearanceUITests/testAppearanceAndConversationKeyboardInputRemainComplete',
      'AssistantAppearanceUITests/testNeutralChoiceNameValidationAndVoiceOver',
      'AssistantAppearanceUITests/testRequiredAppearanceNameKeyboardAndRelaunch',
      'AssistantReplyEntryUITests/testSavedReplyWaitsForAppearanceAndOpensAfterSave',
      'ReplyFocusGeometryUITests/testSavedReplyAndNewerGenerationRevealWithinRealViewport',
      'KeyboardSafeAreaUITests/testConversationOutputComposerAndSwipeUndoAcrossAppearances',
      'ConversationComposerDockUITests/testDockRemainsReachableAcrossConversationStates',
      'ConversationToolEventsUITests/testSyntheticToolCallsExpandIndependentlyWithNativeTargets',
      'ConversationRetentionUITests/testStreamSurvivesNavigationBackgroundAndRestoresAfterRestart',
      'ConversationRetentionUITests/testCompletionCommitsOnceWhileAnotherConversationIsVisible',
      'ConversationRetentionUITests/testCompletionCommitsWhileBackgroundLeaseIsActive',
      'ConversationRetentionUITests/testNativeLeaseEndsAfterCommittedCompletion',
      'ConversationRetentionUITests/testNativeLeaseEndsAfterProviderFailure',
      'ConversationRetentionUITests/testNativeLeaseEndsAfterExplicitStop',
    ],
  },
  'questions-accessibility': {
    ...questionFixture,
    // These standalone methods retain keyboard, large-text, gesture and cleanup boundaries.
    cases: [
      'KeyboardSafeAreaUITests/testKoreanPrimaryActionRemainsReachableWithLargeTextAndKeyboardOpen',
      'KeyboardSafeAreaUITests/testConversationLongTitlesAndFullSwipeAcrossTextSizes',
      'ConversationComposerDockUITests/testFailureKeepsComposerReachable',
      'ConversationComposerDockUITests/testCompactHistorySelectionReturnsToConversation',
      'ConversationHealthSummaryUITests/testSyntheticSummaryCardSourceRetryAndVoiceOver',
      'ConversationVisitPreparationUITests/testLongPreparedQuestionKeepsAccessibleOrderWithLargeTextAndKeyboard',
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
