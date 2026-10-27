/** Maps Swift test files that extend an XCTest suite declared in another source file. */
export const swiftSuiteExtensions = new Map([
  ['OrotUITests/HealthRecordsDetailDuoUITests.swift', 'HealthImportDuoUITests'],
  ['OrotUITests/SettingsBackupDuoUITests.swift', 'RootNavigationUITests'],
  ['OrotUITests/RootSettingsNavigationUITests.swift', 'RootNavigationUITests'], // Multiple files may extend one suite.
  ['OrotUITests/ProviderSelectionDuoUITests.swift', 'RootNavigationUITests'],
]);
