import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestConfig } from '../ios-test-config.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import {
  iosTestCohort,
  iosTestCohortTasks,
  verifyIosSimulatorOwnerContract,
} from '../ios-test-cohorts.mjs';

test('three execution cohorts retain both build configurations and the separate Speech runtime', () => {
  assert.equal(iosTestCohort('release').config.configuration, 'Release');
  assert.equal(iosTestCohort('debug').config.configuration, 'Debug');
  assert.equal(iosTestCohort('speech').config.runtimeBuild, '23C54');
  assert.equal(iosTestCohort('speech').config.device, iosTestConfig('speech').device);
  assert.deepEqual(iosTestCohort('release').profiles, [
    'core',
    'fixtures',
    'backup',
    'local-model',
  ]);
  assert.throws(() => iosTestCohort('unknown'));
});

test('cohort tasks preserve the complete registered inventory, including every fixture group and both Speech boundaries', () => {
  const tasks = ['release', 'speech', 'debug'].flatMap(iosTestCohortTasks);
  const actual = new Set(tasks.flatMap((task) => task.identifiers));
  const profiles = [
    'core',
    'speech',
    'backup',
    'local-model',
    'fixtures',
    'provider-data',
    'health-import',
    'microphone',
    'provider-selection',
  ];
  const expected = new Set([
    ...profiles.flatMap((profile) => iosTestInventory(profile)),
    ...iosTestInventory('speech', 'preparation'),
  ]);
  assert.equal(actual.size, 143);
  assert.deepEqual([...actual].sort(), [...expected].sort());
  assert.equal(tasks.filter((task) => task.profile === 'fixtures').length, 4);
  assert.deepEqual(
    tasks.filter((task) => task.profile === 'speech').map((task) => task.suite),
    ['preparation', 'integration', 'journey'],
  );
});

test('explicit compatible cohort ownership cannot authorize another configuration, runtime or ordinary profile owner', () => {
  const definition = iosTestCohort('release');
  const owner = {
    cohort: 'release',
    profiles: definition.profiles,
    runtime: definition.config.runtime,
    device: definition.config.device,
    name: 'OrotTests-cohort-release-unit-1',
  };
  for (const profile of definition.profiles)
    assert.doesNotThrow(() => verifyIosSimulatorOwnerContract(owner, profile));
  assert.throws(() => verifyIosSimulatorOwnerContract(owner, 'speech'));
  assert.throws(() => verifyIosSimulatorOwnerContract(owner, 'provider-data'));
  for (const change of [
    { profiles: ['core', 'fixtures'] },
    { profile: 'core' },
    { device: iosTestConfig('speech').device },
    { name: 'foreign-device' },
  ])
    assert.throws(() => verifyIosSimulatorOwnerContract({ ...owner, ...change }, 'core'));
  const ordinary = { ...iosTestConfig('core'), name: 'ordinary-owner' };
  assert.doesNotThrow(() => verifyIosSimulatorOwnerContract(ordinary, 'core'));
  assert.throws(() => verifyIosSimulatorOwnerContract(ordinary, 'fixtures'));
});

test('Core verifies the integration target before scheduling UI, without losing or duplicating any case', () => {
  const tasks = iosTestCohortTasks('release').filter((task) => task.profile === 'core');
  assert.deepEqual(
    tasks.map((task) => task.suite),
    ['shared-persistence', 'isolation', 'integration', 'ui'],
  );
  assert.deepEqual(
    tasks.flatMap((task) => task.identifiers).sort(),
    iosTestInventory('core').sort(),
  );
  for (const task of tasks)
    assert.equal(new Set(task.identifiers.map((id) => id.split('/')[0])).size, 1);
  assert.throws(() => iosTestInventory('core', 'preparation'));
});

test('two Release destinations partition the original work exactly once and preserve stateful phase boundaries', () => {
  const names = ['release-core', 'release-ui'];
  const original = iosTestCohortTasks('release');
  const partitioned = names.flatMap(iosTestCohortTasks);
  const key = (task) => task.profile + '/' + task.suite;
  assert.deepEqual(partitioned.map(key).sort(), original.map(key).sort());
  assert.deepEqual(
    names.map((name) => iosTestCohortTasks(name).flatMap((task) => task.identifiers).length),
    [75, 31],
  );
  assert.deepEqual(iosTestCohortTasks('release-core').map(key), [
    'core/shared-persistence',
    'core/isolation',
    'core/integration',
    'core/ui',
    'backup/all',
    'local-model/all',
    'fixtures/questions',
  ]);
  assert.deepEqual(iosTestCohortTasks('release-ui').map(key), [
    'fixtures/navigation',
    'fixtures/recordings',
    'fixtures/calendar',
  ]);
  for (const name of names) {
    const definition = iosTestCohort(name);
    const owner = {
      cohort: name,
      profiles: definition.profiles,
      runtime: definition.config.runtime,
      device: definition.config.device,
      name: `OrotTests-cohort-${name}-unit`,
    };
    for (const profile of definition.profiles)
      assert.doesNotThrow(() => verifyIosSimulatorOwnerContract(owner, profile));
    assert.throws(() =>
      verifyIosSimulatorOwnerContract({ ...owner, cohort: 'release' }, definition.profiles[0]),
    );
  }
});
