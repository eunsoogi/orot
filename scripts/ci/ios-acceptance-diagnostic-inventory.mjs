/** These cases require a disposable install, explicit process boundaries, or a scheduled system event. */
export const iosAcceptanceDiagnosticTests = [
  'OrotIntegrationTests/AutomaticRecapPersistenceIntegrationTests/testSyntheticTranscriptionAutomaticallySavesOfficialRecap',
  'OrotIntegrationTests/AutomaticRecapPersistenceIntegrationTests/testOfficialRecapReadbackMatchesAfterNewProcess',
  'OrotIntegrationTests/DailyReminderSystemCenterTests/testDailyPreferenceRegistersPrivacySafeRequestWithSystemCenter',
  'OrotUITests/DailyReminderDeliveryUITests/testScheduledDailyReminderOpensPreparationFromSystemBanner',
  'OrotUITests/RecordingBackgroundRecoveryUITests/testSavedAudioReopensAfterBackgroundAndRelaunch',
];
