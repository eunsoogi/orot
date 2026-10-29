/** Independent UI cases share products and one owned destination. Explicit case policy chooses fresh installation or verified app-scoped reset. */
export const iosFixtureGroups = Object.freeze({
  navigation: [
    'AiFeatureNavigationUITests',
    'SafeAreaNavigationUITests',
    'HomeDuoUITests',
    'RootNavigationUITests',
    'WindowGeometryUITests',
    'OrientationPresentationAnchorUITests',
    'PagedHealthRecordsUITests',
    'UnifiedImportUITests',
  ],
  recordings: [
    'RecordingLibraryUITests',
    'RecordingDeletionLatencyUITests',
    'RecordingDeletionRecoveryUITests',
    'RecordingPlaybackUITests',
  ],
  questions: [
    'NextVisitReviewUITests',
    'KeyboardSafeAreaUITests',
    'VisitQuestionConsentUITests',
    'SummaryAndLiteratureUITests',
  ],
  calendar: [
    'HealthImportUITests',
    'AppointmentConsentUITests',
    'StorageMigrationUITests',
    'AppointmentsUITests',
    'AppointmentReminderJourneyUITests',
    'SymptomJournalUITests',
    'SymptomJournalRecoveryUITests',
    'SymptomJournalAccessibilityUITests',
    'CalendarSelectionUITests',
    'ScheduleCalendarUITests',
    'ManualHistoryUITests',
    'MedicalDocumentImportJourneyUITests',
  ],
});

/** Every maintained fixture must belong to exactly one group; a new or overlapping class cannot silently disappear from the full matrix. */
export function selectIosFixtureGroup(inventory, group) {
  if (group !== 'all' && !Object.hasOwn(iosFixtureGroups, group))
    throw new Error('Unknown integration fixture group');
  for (const identifier of inventory) {
    const name = identifier.split('/')[1];
    if (Object.values(iosFixtureGroups).filter((classes) => classes.includes(name)).length !== 1)
      throw new Error('Each integration fixture must have exactly one explicit hosted group');
  }
  const selected =
    group === 'all'
      ? inventory.slice()
      : inventory.filter((identifier) =>
          iosFixtureGroups[group].includes(identifier.split('/')[1]),
        );
  if (!selected.length) throw new Error('iOS fixture group cannot be empty');
  return selected;
}
