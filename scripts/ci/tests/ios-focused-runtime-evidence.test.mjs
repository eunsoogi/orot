import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyFocusedRuntimeEvidence } from '../ios-focused-runtime-evidence.mjs';
import { iosTestConfig } from '../ios-test-config.mjs';
import { iosTestCohort } from '../ios-test-cohorts.mjs';

test('focused runtime evidence binds the observed device, runtime and workflow attempt', () => {
  const config = iosTestConfig('speech');
  const owner = {
    profile: 'speech',
    name: 'OrotTests-speech-123-2',
    udid: '11111111-2222-3333-4444-555555555555',
    runtime: config.runtime,
    device: config.device,
  };
  const record = {
    event: 'pre-boot-inventory',
    device: { udid: owner.udid, deviceTypeIdentifier: owner.device, isAvailable: true },
    runtime: { identifier: owner.runtime, buildversion: config.runtimeBuild, isAvailable: true },
  };
  const context = { runId: '123', attempt: '2' };
  assert.equal(
    verifyFocusedRuntimeEvidence(owner, [record], 'speech', context).runtimeBuild,
    '23C54',
  );
  for (const [changedOwner, records, changedContext] of [
    [owner, [], context],
    [owner, [record, record], context],
    [owner, [record], { ...context, attempt: '1' }],
    [{ ...owner, udid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, [record], context],
    [owner, [{ ...record, runtime: { ...record.runtime, buildversion: 'wrong' } }], context],
    [owner, [{ ...record, device: { ...record.device, isAvailable: false } }], context],
  ])
    assert.throws(() =>
      verifyFocusedRuntimeEvidence(changedOwner, records, 'speech', changedContext),
    );
});

test('partition evidence cannot substitute another cohort owner', () => {
  const cohort = iosTestCohort('navigation-features');
  const owner = {
    cohort: cohort.name,
    profiles: cohort.profiles,
    name: 'OrotTests-cohort-navigation-features-123-1',
    udid: '11111111-2222-3333-4444-555555555555',
    runtime: cohort.config.runtime,
    device: cohort.config.device,
  };
  const records = [
    {
      event: 'pre-boot-inventory',
      device: { udid: owner.udid, deviceTypeIdentifier: owner.device, isAvailable: true },
      runtime: { identifier: owner.runtime, buildversion: 'build', isAvailable: true },
    },
  ];
  assert.equal(
    verifyFocusedRuntimeEvidence(
      owner,
      records,
      cohort.profiles[0],
      { runId: '123', attempt: '1' },
      cohort.name,
    ).udid,
    owner.udid,
  );
  assert.throws(() =>
    verifyFocusedRuntimeEvidence(
      owner,
      records,
      cohort.profiles[0],
      { runId: '123', attempt: '1' },
      'navigation-routes',
    ),
  );
});
