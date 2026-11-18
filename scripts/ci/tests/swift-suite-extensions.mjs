/** Maps Swift test files that extend an XCTest suite declared in another source file. */
export const swiftSuiteExtensions = new Map([
  ['OrotUITests/ClassificationStagesUITests.swift', 'AppointmentConsentUITests'],
  ['OrotIntegrationTests/RealtimeVoiceToolLifecycleTests.swift', 'RealtimeVoiceLifecycleTests'],
  ['OrotIntegrationTests/RealtimeVoiceSystemLifecycleTests.swift', 'RealtimeVoiceLifecycleTests'],
  ['OrotUITests/HealthRecordsDetailDuoUITests.swift', 'HealthImportDuoUITests'],
  ['OrotUITests/SettingsBackupDuoUITests.swift', 'RootNavigationUITests'],
  ['OrotUITests/RootSettingsNavigationUITests.swift', 'RootNavigationUITests'], // Multiple files may extend one suite.
  ['OrotUITests/SettingsPortraitNavigationUITests.swift', 'RootNavigationUITests'],
  ['OrotUITests/NavigationVoiceOverUITests.swift', 'RootNavigationUITests'],
  ['OrotUITests/ProviderSelectionDuoUITests.swift', 'RootNavigationUITests'],
  ['OrotUITests/AppointmentNextVisitUITests.swift', 'AppointmentsUITests'],
  ['OrotUITests/AppointmentIdentityDuoUITests.swift', 'AppointmentsUITests'],
]);
