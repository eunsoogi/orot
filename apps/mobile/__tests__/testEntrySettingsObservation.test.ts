import { readInitialTestEntrySettings } from '../e2e/testEntrySettingsObservation';
import { selectTestRoute } from '../e2e/testRoute';

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

  const result = readInitialTestEntrySettings(manager, selectTestRoute);

  expect(settingsReads).toBe(1);
  expect(getConstants).not.toHaveBeenCalled();
  expect(result.settings).toBe(settings);
  expect(result.observation).toMatchObject({
    managerAvailable: true,
    settingsAvailable: true,
    source: 'settings',
    flags: {
      OROT_TEST_NAVIGATION_OBSERVATION: { type: 'string', value: 'YES' },
      OROT_TEST_EXPORT_OBSERVATION: { type: 'not-evaluated', value: null },
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

  const result = readInitialTestEntrySettings(
    { getConstants },
    selectTestRoute,
  );

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

test('selects the AI route before short-circuiting an unevaluated export flag', () => {
  const settingReads: string[] = [];
  const settings = new Proxy<Record<string, unknown>>(
    {
      OROT_TEST_SCENARIO: 'ai-feature-visit-questions',
      OROT_TEST_NAVIGATION_OBSERVATION: 'YES',
      OROT_TEST_UI_GEOMETRY: 'YES',
    },
    {
      get(target, property, receiver) {
        const name = String(property);
        settingReads.push(name);
        if (name === 'OROT_TEST_EXPORT_OBSERVATION') {
          // The original OR expression never evaluates this property when navigation is enabled.
          throw new Error('export observation must stay unevaluated');
        }
        return Reflect.get(target, property, receiver);
      },
    },
  );

  const result = readInitialTestEntrySettings({ settings }, selectTestRoute);

  expect(result.route).toBe('ai-feature-visit-questions');
  expect(settingReads).toEqual([
    'OROT_TEST_HOST',
    'OROT_TEST_HOST',
    'OROT_TEST_SCENARIO',
    'OROT_TEST_NAVIGATION_OBSERVATION',
    'OROT_TEST_APPEARANCE_OBSERVATION',
    'OROT_TEST_REMINDER_OBSERVATION',
    'OROT_TEST_UI_GEOMETRY',
  ]);
  expect(Object.keys(result.observation.flags)).toEqual([
    'OROT_TEST_NAVIGATION_OBSERVATION',
    'OROT_TEST_EXPORT_OBSERVATION',
    'OROT_TEST_UI_GEOMETRY',
  ]);
  expect(result.observation.flags.OROT_TEST_EXPORT_OBSERVATION).toEqual({
    type: 'not-evaluated',
    value: null,
  });
});

test('reads export observation once when navigation observation is disabled', () => {
  let exportReads = 0;
  const settings = {
    OROT_TEST_NAVIGATION_OBSERVATION: 'NO',
    get OROT_TEST_EXPORT_OBSERVATION() {
      exportReads += 1;
      return 'YES';
    },
  };

  const result = readInitialTestEntrySettings({ settings }, selectTestRoute);

  expect(result.route).toBe('core');
  expect(exportReads).toBe(1);
  expect(result.observation.lifecycleObservation).toBe(true);
  expect(result.observation.geometryObservation).toBe(true);
  expect(result.observation.flags.OROT_TEST_EXPORT_OBSERVATION).toEqual({
    type: 'string',
    value: 'YES',
  });
});
