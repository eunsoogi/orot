/** Independent UI cases share portable products, but each group owns one hosted destination and preserves per-case fresh-install isolation. */
export const iosFixtureGroups = Object.freeze({
  navigation: [
    'PersistenceUITests',
    'AiFeatureNavigationUITests',
    'SafeAreaNavigationUITests',
    'RootNavigationUITests',
    'PagedHealthRecordsUITests',
    'UnifiedImportUITests',
  ],
  recordings: ['RecordingLibraryUITests', 'RecordingPlaybackUITests'],
  questions: ['NextVisitReviewUITests', 'KeyboardSafeAreaUITests', 'VisitQuestionConsentUITests'],
  calendar: [
    'HealthImportUITests',
    'AppointmentConsentUITests',
    'StorageMigrationUITests',
    'AppointmentsUITests',
    'CalendarSelectionUITests',
  ],
});

/** Every maintained fixture must belong to exactly one group; a new or overlapping class cannot silently disappear from the full matrix. */
export function selectIosFixtureGroup(inventory, group) {
  if (group !== 'all' && !Object.hasOwn(iosFixtureGroups, group))
    throw new Error('Unknown native fixture group');
  for (const identifier of inventory) {
    const name = identifier.split('/')[1];
    if (Object.values(iosFixtureGroups).filter((classes) => classes.includes(name)).length !== 1)
      throw new Error('Each native fixture must have exactly one explicit hosted group');
  }
  const selected =
    group === 'all'
      ? inventory.slice()
      : inventory.filter((identifier) =>
          iosFixtureGroups[group].includes(identifier.split('/')[1]),
        );
  if (!selected.length) throw new Error('Native fixture group cannot be empty');
  return selected;
}
