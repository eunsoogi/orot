/** These cases require a disposable install, explicit process boundaries, or a scheduled system event. */
export const iosAcceptanceDiagnosticTests = [
  // Synthetic UI and pure queue policy: no microphone or provider calls.
  'OrotUITests/VoiceConversationCallUITests/testSyntheticFullScreenCallMuteResumeAndEndWithLargeText',
  'OrotIntegrationTests/VoiceConversationLifecycleTests/testDuplexOutputQueueHasFiniteBudget',
  'OrotIntegrationTests/VoiceConversationLifecycleTests/testDuplexCallbackBudgetSurvivesGenerationReset',
  // Existing-authorized on-device recognition with checked-in PCM; never opens input hardware.
  'OrotIntegrationTests/VoiceConversationLifecycleTests/testSyntheticPCMRecognitionContinuesAcrossTurns',
  // Real system synthesis is opt-in; the production adapter is silent and never opens the microphone.
  'OrotIntegrationTests/VoiceConversationLifecycleTests/testSystemSpeechCompletionAndStopReleasePlayback',
  'OrotIntegrationTests/AutomaticRecapPersistenceIntegrationTests/testSyntheticTranscriptionAutomaticallySavesOfficialRecap',
  'OrotIntegrationTests/AutomaticRecapPersistenceIntegrationTests/testOfficialRecapReadbackMatchesAfterNewProcess',
  'OrotIntegrationTests/DailyReminderSystemCenterTests/testDailyPreferenceRegistersPrivacySafeRequestWithSystemCenter',
  'OrotUITests/DailyReminderDeliveryUITests/testScheduledDailyReminderOpensPreparationFromSystemBanner',
  'OrotUITests/RecordingBackgroundRecoveryUITests/testSavedAudioReopensAfterBackgroundAndRelaunch',
  'OrotUITests/ChartFoundationUITests/testDenseChartPagesKeepOutlierReachable',
];

/** Explicit single-case Duo acceptance journeys stay selectable outside routine Duo runs. */
export const duoAcceptanceDiagnosticTests = [
  'OrotUITests/TestHostConnectionTests/testAppointmentRotationGeometryObservation',
  'OrotUITests/ChartConsumerAcceptanceUITests/testBloodPressureValuesAndDiastolicVoiceOver',
  'OrotUITests/MedicalDocumentPickerRecoveryUITests/testPhotoPickerCancelRestoresInteraction',
  'OrotUITests/MedicalDocumentImportJourneyUITests/testTextBasedPdfCanBeReviewedSavedAndOpenedWithProvenance',
  // Explicitly observe long-content bounds beside the native rail; keep default suites unchanged.
  'OrotUITests/RootNavigationUITests/testLargeTextKeepsRootTabsAndRecordingActionsReachable',
];
