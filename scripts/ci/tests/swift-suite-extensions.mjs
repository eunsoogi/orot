/** Maps Swift test files that extend an XCTest suite declared in another source file. */
export const swiftSuiteExtensions = new Map([
  ['OrotUITests/HealthRecordsDetailDuoUITests.swift', 'HealthImportDuoUITests'],
  // Keep the focused Home accessibility test in the Home Duo suite inventory.
  ['OrotUITests/HomeMetricAccessibilityUITests.swift', 'HomeDuoUITests'],
  ['OrotUITests/SettingsBackupDuoUITests.swift', 'RootNavigationUITests'],
  ['OrotUITests/RootSettingsNavigationUITests.swift', 'RootNavigationUITests'], // Multiple files may extend one suite.
  ['OrotUITests/SettingsPortraitNavigationUITests.swift', 'RootNavigationUITests'],
  ['OrotUITests/NavigationVoiceOverUITests.swift', 'RootNavigationUITests'],
  ['OrotUITests/ProviderSelectionDuoUITests.swift', 'RootNavigationUITests'],
  ['OrotUITests/AppointmentNextVisitUITests.swift', 'AppointmentsUITests'],
]);
