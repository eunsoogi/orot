import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const noOp = async () => {};

function matcher() {
  return {
    not: { toBeVisible: noOp, toExist: noOp },
    toBeVisible: noOp,
    toBeFocused: noOp,
    toExist: noOp,
    toHaveText: noOp,
    toHaveLabel: noOp,
    toBe: noOp,
    toBeGreaterThan: noOp,
    toBeGreaterThanOrEqual: noOp,
  };
}

async function executeE2ECases(fileName) {
  const source = readFileSync(join(repositoryRoot, 'apps/mobile/e2e', fileName), 'utf8');
  const cases = [];
  const beforeEachHooks = [];
  const afterEachHooks = [];
  const calls = [];
  const waitMatcher = () => ({ withTimeout: noOp });
  const elementHandle = {
    getAttributes: async () => ({
      enabled: true,
      frame: { x: 0, y: 0, width: 100, height: 100 },
      label: 'keyboard-visible:40:60',
    }),
    scrollTo: noOp,
    tap: noOp,
  };

  // Record actual E2E case bodies; hosted Detox remains the UI and storage oracle.
  runInNewContext(source, {
    afterEach: (hook) => afterEachHooks.push(hook),
    beforeEach: (hook) => beforeEachHooks.push(hook),
    by: { id: (value) => ({ id: value }) },
    describe: (_name, defineCases) => defineCases(),
    device: {
      clearKeychain: async () => calls.push({ kind: 'clearKeychain' }),
      installApp: async () => calls.push({ kind: 'installApp' }),
      launchApp: async (options) =>
        calls.push({ kind: 'launchApp', options: JSON.parse(JSON.stringify(options)) }),
      setOrientation: async (orientation) => calls.push({ kind: 'setOrientation', orientation }),
      terminateApp: async () => calls.push({ kind: 'terminateApp' }),
      uninstallApp: async () => calls.push({ kind: 'uninstallApp' }),
    },
    element: () => elementHandle,
    expect: matcher,
    it: (name, body) => cases.push({ name, body }),
    require: (specifier) => {
      assert.equal(specifier, '@jest/globals');
      return { expect: matcher };
    },
    waitFor: () => ({
      toBeVisible: waitMatcher,
      toExist: waitMatcher,
      toHaveLabel: waitMatcher,
      toHaveText: waitMatcher,
    }),
  });

  for (const testCase of cases) {
    for (const hook of beforeEachHooks) await hook();
    await testCase.body();
    for (const hook of afterEachHooks) await hook();
  }

  return { calls, names: cases.map(({ name }) => name) };
}

test('each Safe Area scenario launches the app once with its required startup configuration', async () => {
  const { calls, names } = await executeE2ECases('safe-area.test.js');

  assert.equal(names.length, 4);
  assert.deepEqual(
    calls.filter(({ kind }) => kind === 'launchApp'),
    [
      {
        kind: 'launchApp',
        options: { newInstance: true, languageAndLocale: { language: 'en', locale: 'en_US' } },
      },
      {
        kind: 'launchApp',
        options: { newInstance: true, languageAndLocale: { language: 'en', locale: 'en_US' } },
      },
      {
        kind: 'launchApp',
        options: {
          newInstance: true,
          languageAndLocale: { language: 'en', locale: 'en_US' },
          launchArgs: { OROT_E2E_PROBE: 'safe-area-blood-pressure' },
        },
      },
      {
        kind: 'launchApp',
        options: {
          newInstance: true,
          languageAndLocale: { language: 'en', locale: 'en_US' },
          launchArgs: {
            OROT_E2E_PROBE: 'safe-area',
            UIPreferredContentSizeCategoryName: 'UICTContentSizeCategoryAccessibilityXXXL',
          },
        },
      },
    ],
  );
});

test('storage and migration scenarios keep their clean-phase, restart, and migration launch sequence', async () => {
  const storage = await executeE2ECases('storage.test.js');
  const migration = await executeE2ECases('storage-migration.test.js');

  assert.equal(storage.names.length, 2);
  assert.deepEqual(storage.calls, [
    {
      kind: 'launchApp',
      options: { newInstance: false, launchArgs: { OROT_STORAGE_PROBE: 'fresh' } },
    },
    {
      kind: 'launchApp',
      options: { newInstance: false, launchArgs: { OROT_STORAGE_PROBE: 'fresh' } },
    },
    { kind: 'terminateApp' },
    {
      kind: 'launchApp',
      options: { newInstance: true, launchArgs: { OROT_STORAGE_PROBE: 'restart' } },
    },
  ]);
  assert.deepEqual(migration.calls, [
    {
      kind: 'launchApp',
      options: { newInstance: false, launchArgs: { OROT_STORAGE_PROBE: 'legacy' } },
    },
    { kind: 'terminateApp' },
    {
      kind: 'launchApp',
      options: { newInstance: true, launchArgs: { OROT_E2E_PROBE: 'appointments' } },
    },
  ]);
});
