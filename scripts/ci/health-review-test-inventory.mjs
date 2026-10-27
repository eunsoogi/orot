// Each UI method owns its request fixture, restart sequence and cleanup; graph persistence phases remain separate.
export const healthReviewUiTests = [
  'OrotUITests/HealthReviewUITests/testHealthKitReviewCitationReturnRetainsSession',
  'OrotUITests/HealthReviewUITests/testPendingRestoresAcrossFreshProcessWithoutAutomaticInference',
  'OrotUITests/HealthReviewUITests/testExplicitClarificationContinuesExactPendingReview',
  'OrotUITests/HealthReviewUITests/testUnknownSymptomsShowsEveryRequiredActionBeforeInference',
  'OrotUITests/HealthReviewUITests/testDeniedRemoteConsentSendsNoModelRequest',
  'OrotUITests/HealthReviewUITests/testCancellationRejectsLateModelPublication',
  'OrotUITests/HealthReviewUITests/testChangedEvidenceCitationAndRequestDeletionPreserveImportedRecords',
];
