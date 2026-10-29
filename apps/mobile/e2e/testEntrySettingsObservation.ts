/** Reads the test bundle's first native settings snapshot and exposes only allowlisted launch flags. */
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
    OROT_TEST_HOST: SettingsObservationValue;
    OROT_TEST_NAVIGATION_OBSERVATION: SettingsObservationValue;
    OROT_TEST_EXPORT_OBSERVATION: SettingsObservationValue;
    OROT_TEST_UI_GEOMETRY: SettingsObservationValue;
  };
  lifecycleObservation: boolean;
  geometryObservation: boolean;
};

function observeValue(value: unknown): SettingsObservationValue {
  if (typeof value === 'string' || typeof value === 'boolean') {
    return { type: typeof value, value };
  }
  if (typeof value === 'number') {
    return { type: 'number', value: Number.isFinite(value) ? value : null };
  }
  return { type: value === null ? 'null' : typeof value, value: null };
}

/** Reads the native settings source once and derives observer flags from that same snapshot. */
export function readInitialTestEntrySettings(
  manager?: TestEntrySettingsManager,
): {
  settings: Record<string, unknown>;
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

  const host = settings.OROT_TEST_HOST;
  const navigation = settings.OROT_TEST_NAVIGATION_OBSERVATION;
  const exportObservation = settings.OROT_TEST_EXPORT_OBSERVATION;
  const geometry = settings.OROT_TEST_UI_GEOMETRY;
  const lifecycleObservation =
    navigation === 'YES' || exportObservation === 'YES';

  return {
    settings,
    observation: {
      managerAvailable: manager != null,
      settingsAvailable: flatSettings != null || constantsSettings != null,
      source,
      flags: {
        OROT_TEST_HOST: observeValue(host),
        OROT_TEST_NAVIGATION_OBSERVATION: observeValue(navigation),
        OROT_TEST_EXPORT_OBSERVATION: observeValue(exportObservation),
        OROT_TEST_UI_GEOMETRY: observeValue(geometry),
      },
      lifecycleObservation,
      geometryObservation: geometry === 'YES' || lifecycleObservation,
    },
  };
}
