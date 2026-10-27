/** Explicit native regressions that opt in to the dedicated iPhone Duo runtime. */
export const duoTests = [
  'OrotUITests/TestHostConnectionTests/testHostLaunches',
  'OrotUITests/RootNavigationUITests/testRightRailKeepsAccessibleRootAndContextualNavigation',
  'OrotUITests/WindowGeometryUITests/testDuoGeometryEventsMatchUIKitAndRetainQuestionDraftAcrossSourceNavigation',
  'OrotUITests/OrientationPresentationAnchorUITests/testLandscapeTransitionRetainsQuestionDraftAndSourceRoute',
  'OrotUITests/ManualHistoryUITests/testContextualBackAndHomeHonorDepartureConfirmationInRightRail',
  'OrotUITests/NextVisitReviewUITests/testDuoRightRailKeepsKeyboardSaveInsideTheContentLane',
  'OrotUITests/SafeAreaNavigationUITests/testSystemInsetsAcrossHomeHealthImportRecordingAndBloodPressureLibrary',
  'OrotUITests/RecordingExportUITests/testActualAudioShareDismissalCleansTemporaryFilesAndPreservesSource',
];
