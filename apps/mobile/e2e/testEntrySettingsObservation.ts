/** Reads the native settings snapshot, selects its route, then records allowlisted flags. */
export type TestEntrySettingsManager = {
  settings?: Record<string, unknown> | null;
  getConstants?: () => { settings?: Record<string, unknown> | null } | null;
};

type SettingsObservationValue = {
  type: string;
  value: string | number | boolean | null;
};

export type TestEntrySettingsObservation = {
  managerAvailable: boolean;
  settingsAvailable: boolean;
  source: 'settings' | 'getConstants' | 'unavailable';
  flags: {
    OROT_TEST_NAVIGATION_OBSERVATION: SettingsObservationValue;
    OROT_TEST_EXPORT_OBSERVATION: SettingsObservationValue;
    OROT_TEST_UI_GEOMETRY: SettingsObservationValue;
  };
  lifecycleObservation: boolean;
  geometryObservation: boolean;
};

function observeValue(
  value: unknown,
  evaluated = true,
): SettingsObservationValue {
  // Distinguish a short-circuited flag from a setting whose actual value is undefined.
  if (!evaluated) {
    return { type: 'not-evaluated', value: null };
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return { type: typeof value, value };
  }
  if (typeof value === 'number') {
    return { type: 'number', value: Number.isFinite(value) ? value : null };
  }
  return { type: value === null ? 'null' : typeof value, value: null };
}

/** Selects the original test route before evaluating test-only observation flags. */
export function readInitialTestEntrySettings<Route>(
  manager: TestEntrySettingsManager | undefined,
  selectRoute: (settings: Record<string, unknown>) => Route,
): {
  settings: Record<string, unknown>;
  route: Route;
  appearanceObservation: boolean;
  reminderObservation: boolean;
  observation: TestEntrySettingsObservation;
} {
  // Keep the legacy flat export first; call getConstants only when that initial value is absent.
  const flatSettings = manager?.settings;
  const constants =
    flatSettings == null ? manager?.getConstants?.() : undefined;
  const constantsSettings = constants?.settings;
  const settings = flatSettings ?? constantsSettings ?? {};
  const source =
    flatSettings != null
      ? 'settings'
      : constants != null
        ? 'getConstants'
        : 'unavailable';

  const route = selectRoute(settings);
  const navigation = settings.OROT_TEST_NAVIGATION_OBSERVATION;
  const exportObservationEvaluated = navigation !== 'YES';
  const exportObservation = exportObservationEvaluated
    ? settings.OROT_TEST_EXPORT_OBSERVATION
    : undefined;
  const lifecycleObservation =
    navigation === 'YES' || exportObservation === 'YES';
  const appearanceObservation =
    settings.OROT_TEST_APPEARANCE_OBSERVATION === 'YES';
  const reminderObservation = settings.OROT_TEST_REMINDER_OBSERVATION === 'YES';
  const geometry = settings.OROT_TEST_UI_GEOMETRY;

  return {
    settings,
    route,
    appearanceObservation,
    reminderObservation,
    observation: {
      managerAvailable: manager != null,
      settingsAvailable: flatSettings != null || constantsSettings != null,
      source,
      flags: {
        OROT_TEST_NAVIGATION_OBSERVATION: observeValue(navigation),
        OROT_TEST_EXPORT_OBSERVATION: observeValue(
          exportObservation,
          exportObservationEvaluated,
        ),
        OROT_TEST_UI_GEOMETRY: observeValue(geometry),
      },
      lifecycleObservation,
      geometryObservation: geometry === 'YES' || lifecycleObservation,
    },
  };
}
