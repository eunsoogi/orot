/** Maps Swift test files that extend an XCTest suite declared in another source file. */
export const swiftSuiteExtensions = new Map([
  ['OrotUITests/ClassificationReaderGeometryUITests.swift', 'AppointmentConsentUITests'],
  ['OrotUITests/ClassificationStagesUITests.swift', 'AppointmentConsentUITests'],
  ['OrotIntegrationTests/RealtimeVoiceToolLifecycleTests.swift', 'RealtimeVoiceLifecycleTests'],
  ['OrotIntegrationTests/RealtimeVoiceResultDispatchTests.swift', 'RealtimeVoiceLifecycleTests'],
  ['OrotIntegrationTests/RealtimeVoiceManagedResponsesTests.swift', 'RealtimeVoiceLifecycleTests'],
  [
    'OrotIntegrationTests/RealtimeVoiceManagedTerminalResponseTests.swift',
    'RealtimeVoiceLifecycleTests',
  ],
  ['OrotIntegrationTests/RealtimeVoiceSystemLifecycleTests.swift', 'RealtimeVoiceLifecycleTests'],
  ['OrotIntegrationTests/RealtimeVoiceCommonV3RepeatingTests.swift', 'RealtimeVoiceLifecycleTests'],
  [
    'OrotIntegrationTests/RealtimeVoiceNativeRegistryAssertions.swift',
    'RealtimeVoiceLifecycleTests',
  ],
  [
    'OrotIntegrationTests/RealtimeVoiceForegroundAdmissionTests.swift',
    'RealtimeVoiceLifecycleTests',
  ],
  ['OrotUITests/HealthRecordsDetailDuoUITests.swift', 'HealthImportDuoUITests'],
  ['OrotUITests/SettingsBackupDuoUITests.swift', 'RootNavigationUITests'],
  ['OrotUITests/RootSettingsNavigationUITests.swift', 'RootNavigationUITests'], // Multiple files may extend one suite.
  ['OrotUITests/SettingsPortraitNavigationUITests.swift', 'RootNavigationUITests'],
  ['OrotUITests/NavigationVoiceOverUITests.swift', 'RootNavigationUITests'],
  ['OrotUITests/ProviderSelectionDuoUITests.swift', 'RootNavigationUITests'],
  ['OrotUITests/AppointmentNextVisitUITests.swift', 'AppointmentsUITests'],
  ['OrotUITests/AppointmentIdentityDuoUITests.swift', 'AppointmentsUITests'],
  ['OrotUITests/AppointmentEdgeScrollUITests.swift', 'AppointmentsUITests'],
]);
