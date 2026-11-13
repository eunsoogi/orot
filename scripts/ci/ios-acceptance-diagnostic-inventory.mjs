/** These cases require a disposable install, explicit process boundaries, or a scheduled system event. */
export const iosAcceptanceDiagnosticTests = [
  'OrotIntegrationTests/AutomaticRecapPersistenceIntegrationTests/testSyntheticTranscriptionAutomaticallySavesOfficialRecap',
  'OrotIntegrationTests/AutomaticRecapPersistenceIntegrationTests/testOfficialRecapReadbackMatchesAfterNewProcess',
  'OrotIntegrationTests/DailyReminderSystemCenterTests/testDailyPreferenceRegistersPrivacySafeRequestWithSystemCenter',
  'OrotUITests/DailyReminderDeliveryUITests/testScheduledDailyReminderOpensPreparationFromSystemBanner',
  'OrotUITests/RecordingBackgroundRecoveryUITests/testSavedAudioReopensAfterBackgroundAndRelaunch',
  'OrotUITests/ChartFoundationUITests/testDenseChartPagesKeepOutlierReachable',
];

/** Keep the direct speech observation selectable while the Duo runtime cannot return it reliably. */
export const duoAcceptanceDiagnosticTests = [
  'OrotUITests/TestHostConnectionTests/testAppointmentRotationGeometryObservation',
  'OrotUITests/ChartConsumerAcceptanceUITests/testBloodPressureValuesAndDiastolicVoiceOver',
];
