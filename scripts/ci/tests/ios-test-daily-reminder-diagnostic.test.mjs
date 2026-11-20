import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { environmentForRunner, reminderDiagnosticTest } from '../ios-test-reminder-diagnostic.mjs';

const selector =
  'OrotUITests/DailyReminderDeliveryUITests/testScheduledDailyReminderOpensPreparationFromSystemBanner';
const flag = 'TEST_RUNNER_OROT_DAILY_REMINDER_DIAGNOSTICS';
const uuid = 'TEST_RUNNER_OROT_DAILY_REMINDER_DIAGNOSTIC_RUN_ID';
const admitted = { [flag]: 'YES', [uuid]: '9ae30a38-2911-4555-b5a3-948a6ec879d9' };
const run = (profile = 'core', tests = [selector], env = admitted) =>
  environmentForRunner(profile, tests, 'invocation', env);

test('admits only explicit daily diagnostics while preserving the runner environment', () => {
  assert.deepEqual(run('core', [selector], { ...admitted, KEEP: 'value' }), {
    ...admitted,
    KEEP: 'value',
    TEST_RUNNER_OROT_IOS_TEST_INVOCATION: 'invocation',
  });
  assert.deepEqual(run('core', [selector], {}), {
    TEST_RUNNER_OROT_IOS_TEST_INVOCATION: 'invocation',
  });
});

test('rejects wrong profile, selector, empty selection and duplicate or mixed selections', () => {
  for (const [profile, tests] of [
    ['fixtures', [selector]],
    ['unknown', [selector]],
    ['core', []],
    ['core', ['OrotUITests/Other/test']],
    ['core', [selector, selector]],
    ['core', [selector, reminderDiagnosticTest]],
  ])
    assert.throws(() => run(profile, tests), /Daily reminder/);
});

test('requires the exact flag and valid UUID together, without generating or accepting aliases', () => {
  for (const env of [
    { [flag]: 'YES' },
    { [uuid]: admitted[uuid] },
    { ...admitted, [flag]: 'NO' },
    { ...admitted, [flag]: '' },
    { ...admitted, [uuid]: 'invalid' },
    { ...admitted, [uuid]: `${admitted[uuid]}\n` },
    { ...admitted, TEST_RUNNER_OROT_DAILY_REMINDER_DIAGNOSTIC_EXTRA: 'YES' },
    { OROT_DAILY_REMINDER_DIAGNOSTICS: 'YES' },
    { OROT_TEST_DAILY_REMINDER_DIAGNOSTICS: 'YES' },
  ])
    assert.throws(() => run('core', [selector], env), /Daily reminder/);
});

test('daily admission does not enable or broaden appointment fixture diagnostics', () => {
  const appointment = {
    TEST_RUNNER_OROT_IOS_REMINDER_DIAGNOSTICS: 'YES',
    TEST_RUNNER_OROT_IOS_REMINDER_DIAGNOSTIC_RUN_ID: admitted[uuid],
  };
  assert.throws(() => run('core', [selector], { ...admitted, ...appointment }));
  assert.throws(() => run('fixtures', [reminderDiagnosticTest], { ...admitted, ...appointment }));
  assert.equal(
    run('fixtures', [reminderDiagnosticTest], appointment)
      .TEST_RUNNER_OROT_IOS_REMINDER_DIAGNOSTICS,
    'YES',
  );
});

test('the official runner uses admission at the actual xcodebuild spawn boundary', () => {
  const runner = readFileSync(new URL('../run-ios-tests.mjs', import.meta.url), 'utf8');
  assert.match(runner, /env: environmentForRunner\(profile, tests, invocationId\)/u);
});
