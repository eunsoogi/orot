import { readInitialTestEntrySettings } from '../e2e/testEntrySettingsObservation';

test('captures allowlisted launch flag types from the first flat settings read', () => {
  const settings = {
    OROT_TEST_HOST: 'YES',
    OROT_TEST_NAVIGATION_OBSERVATION: 'YES',
    OROT_TEST_EXPORT_OBSERVATION: undefined,
    OROT_TEST_UI_GEOMETRY: 'YES',
    UNRELATED_TEST_SETTING: 'not captured',
  };
  let settingsReads = 0;
  const getConstants = jest.fn(() => ({ settings }));
  const manager = {
    get settings() {
      settingsReads += 1;
      return settings;
    },
    getConstants,
  };

  const result = readInitialTestEntrySettings(manager);

  expect(settingsReads).toBe(1);
  expect(getConstants).not.toHaveBeenCalled();
  expect(result.settings).toBe(settings);
  expect(result.observation).toMatchObject({
    managerAvailable: true,
    settingsAvailable: true,
    source: 'settings',
    flags: {
      OROT_TEST_HOST: { type: 'string', value: 'YES' },
      OROT_TEST_NAVIGATION_OBSERVATION: { type: 'string', value: 'YES' },
      OROT_TEST_EXPORT_OBSERVATION: { type: 'undefined', value: null },
      OROT_TEST_UI_GEOMETRY: { type: 'string', value: 'YES' },
    },
    lifecycleObservation: true,
    geometryObservation: true,
  });
  expect(Object.keys(result.observation.flags)).not.toContain(
    'UNRELATED_TEST_SETTING',
  );
});

test('uses the constants fallback once and preserves non-string launch values', () => {
  const settings = {
    OROT_TEST_NAVIGATION_OBSERVATION: true,
    OROT_TEST_UI_GEOMETRY: false,
  };
  const getConstants = jest.fn(() => ({ settings }));

  const result = readInitialTestEntrySettings({ getConstants });

  expect(getConstants).toHaveBeenCalledTimes(1);
  expect(result.settings).toBe(settings);
  expect(result.observation).toMatchObject({
    source: 'getConstants',
    flags: {
      OROT_TEST_NAVIGATION_OBSERVATION: { type: 'boolean', value: true },
      OROT_TEST_UI_GEOMETRY: { type: 'boolean', value: false },
    },
    lifecycleObservation: false,
    geometryObservation: false,
  });
});
