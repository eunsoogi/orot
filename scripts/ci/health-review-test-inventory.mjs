// Each UI method owns its request fixture, restart sequence and cleanup; graph persistence phases remain separate.
export const healthReviewUiTests = [
  'OrotUITests/HealthReviewUITests/testManualBloodPressureInputsAreAbsent',
  'OrotUITests/HealthReviewUITests/testRecordObservationShowsBloodPressureGuidanceAndRetainsSessionAcrossProviderNavigation',
  'OrotUITests/HealthReviewUITests/testPendingRestoresAcrossFreshProcessWithoutAutomaticInference',
  'OrotUITests/HealthReviewUITests/testExplicitSymptomAnswerContinuesPendingReviewWithPolicyGuidance',
  'OrotUITests/HealthReviewUITests/testWarningSymptomsStopObservationBeforeInference',
  'OrotUITests/HealthReviewUITests/testDeniedRemoteConsentSendsNoModelRequest',
  'OrotUITests/HealthReviewUITests/testCancellationRejectsLateModelPublication',
  'OrotUITests/HealthReviewUITests/testHealthKitCitationReturnRetainsSession',
  'OrotUITests/HealthReviewUITests/testChangedEvidenceCitationAndRequestDeletionPreserveImportedRecords',
];
