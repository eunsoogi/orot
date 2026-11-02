// Each UI method owns its request fixture, restart sequence and cleanup; graph persistence phases remain separate.
// This registered list also feeds the repository-wide native inventory totals asserted by CI.
export const healthReviewUiTests = [
  'OrotUITests/HealthReviewUITests/testRecordObservationShowsBloodPressureGuidanceAndRetainsSessionAcrossProviderNavigation',
  'OrotUITests/HealthReviewUITests/testPendingRestoresAcrossFreshProcessWithoutAutomaticInference',
  'OrotUITests/HealthReviewUITests/testExplicitSymptomAnswerContinuesPendingReviewWithPolicyGuidance',
  'OrotUITests/HealthReviewUITests/testWarningSymptomsStopObservationBeforeInference',
  'OrotUITests/HealthReviewUITests/testDeniedRemoteConsentSendsNoModelRequest',
  'OrotUITests/HealthReviewUITests/testCancellationRejectsLateModelPublication',
  'OrotUITests/HealthReviewUITests/testHealthKitCitationReturnRetainsSession',
  'OrotUITests/HealthReviewUITests/testChangedEvidenceCitationAndRequestDeletionPreserveImportedRecords',
];
