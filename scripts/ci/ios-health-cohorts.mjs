const healthFixture = { profiles: ['health-import'], minutes: 20 };

// Balance complete independent methods, including their original fresh-install and cleanup boundaries.
// Both hosted leaves repeat owned Simulator/UI preparation; neither relies on a sibling's state.
export const healthCohorts = {
  health: healthFixture,
  'health-observations': {
    ...healthFixture,
    cases: [
      'HealthImportUITests/testCommonObservationsUseEncryptedStorageAndIdempotentReplay',
      'UnifiedImportUITests/testSyntheticConsentMeasurementsAndExplicitCalendarConfirmation',
    ],
  },
  'health-recovery': {
    ...healthFixture,
    cases: [
      'HealthImportUITests/testSyntheticBloodPressurePersistsAndReplaysAfterProcessRestart',
      'UnifiedImportUITests/testCancellationPreventsQueriesAndPersistenceBeforeSameSelectionRetry',
    ],
  },
};
