// Each recording leaf retains the same fixture/reset contract while owning independent complete methods.
const recordingFixture = { profiles: ['fixtures'], suites: ['recordings'], minutes: 20 };

export const recordingCohorts = {
  recordings: recordingFixture,
  'recordings-controls': {
    ...recordingFixture,
    cases: [
      'RecordingLibraryUITests/testActiveAndPausedRecordingControlsAcrossAppearanceChanges',
      'RecordingLibraryUITests/testRecordingConsentAndSeparateLibraryAcrossAppearanceChanges',
      'RecordingLibraryUITests/testSavedRecordingRowsRemainReadableInA320PointViewport',
      'RecordingDeletionLatencyUITests/testSyntheticRecordingDeletionTimingDistribution',
      'RecordingDeletionRecoveryUITests/testFailedDeletionRestoresAudioAndKeepsSourceDuringSlowListRead',
      'RecordingDeletionRecoveryUITests/testDelayedAudioCleanupKeepsProgressUntilCleanupCompletes',
    ],
  },
  'recordings-review': {
    ...recordingFixture,
    cases: [
      'RecordingLibraryUITests/testSavedMetadataAndTranscriptReviewRemainReadableAcrossLiveAppearanceChanges',
      'RecordingLibraryUITests/testLargeTextKeepsTranscriptSaveReachableWithKeyboardVisible',
    ],
  },
  'recordings-playback': { ...recordingFixture, classes: ['RecordingPlaybackUITests'] },
};
