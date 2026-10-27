export { encounterReviewPersistenceTests } from './encounter-review-persistence-test-phases.mjs';

export const encounterReviewUiTests = [
  'OrotUITests/EncounterReviewUITests/testSavedRecordingReviewRestoresWithoutAutomaticExtractionOrApproval',
  'OrotUITests/EncounterReviewUITests/testDeniedTransmissionAndExplicitRejectionWriteNoRecords',
  'OrotUITests/EncounterReviewUITests/testTranscriptCorrectionPreventsStaleCandidateApproval',
  'OrotUITests/EncounterReviewUITests/testDeletedRecordingPreventsLateCandidateApproval',
];
