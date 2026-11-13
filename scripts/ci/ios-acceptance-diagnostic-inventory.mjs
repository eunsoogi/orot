/** These cases require a disposable install, explicit process boundaries, or a scheduled system event. */
export const iosAcceptanceDiagnosticTests = [
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
];
