import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fixture as runnerFixture } from './fixtures/ios-test-runner.mjs';
import { fixture } from './fixtures/ios-test-fixture-driver.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

// These command fixtures prove runner scheduling and reset boundaries, not actual UI acceptance.
test('one runner retains explicit preparation and exact observations for every selected independent UI case', () => {
  const identifiers = iosTestInventory('fixtures', 'recordings').slice(0, 3);
  const value = fixture({ selectedIdentifiers: identifiers, failFirst: false });
  try {
    assert.equal(value.outcome.status, 0, value.outcome.stderr);
    assert.equal(value.calls.filter((call) => call.name === 'xcodebuild').length, 1);
    assert.equal(value.calls.filter((call) => call.args[1] === 'privacy').length, 4);
    assert.deepEqual(
      value
        .report()
        .observations.map((item) => item.identifier)
        .sort(),
      identifiers.slice().sort(),
    );
    assert.deepEqual(value.report().notRun, []);
  } finally {
    value.dispose();
  }
});

test('an original failed case withholds later preparation in the same runner and retains its raw result', () => {
  const identifiers = iosTestInventory('fixtures', 'recordings').slice(0, 3);
  const value = fixture({ selectedIdentifiers: identifiers });
  try {
    assert.notEqual(value.outcome.status, 0);
    assert.equal(value.calls.filter((call) => call.name === 'xcodebuild').length, 1);
    assert.equal(value.calls.filter((call) => call.args[1] === 'privacy').length, 2);
    assert.deepEqual(value.report().notRun, identifiers.slice(1));
    assert.equal(value.report().rawObservations[0].result, 'Failed');
  } finally {
    value.dispose();
  }
});

for (const profile of ['fixtures', 'health-import', 'microphone', 'provider-selection', 'backup']) {
  test(`${profile} keeps its explicit profile and reset policy in a shared session`, () => {
    const identifiers =
      profile === 'fixtures'
        ? iosTestInventory(profile, 'calendar').filter(
            (id) =>
              id.includes('/StorageMigrationUITests/') ||
              id.includes('/CalendarSelectionUITests/') ||
              id.includes('/ScheduleCalendarUITests/'),
          )
        : iosTestInventory(profile).slice(0, profile === 'backup' ? 3 : undefined);
    // All three picker journeys overlap with `fixtures`; the complete selection must keep its requested profile.
    if (profile === 'health-import')
      assert.equal(
        identifiers.filter((identifier) =>
          identifier.includes('/MedicalDocumentImportJourneyUITests/'),
        ).length,
        3,
      );
    const value = fixture({ profile, selectedIdentifiers: identifiers, failFirst: false });
    try {
      assert.equal(value.outcome.status, 0, value.outcome.stderr);
      assert.equal(value.calls.filter((call) => call.name === 'xcodebuild').length, 1);
      const lifecycleLog = readFileSync(
        join(value.output, 'session.xcresult.lifecycle.log'),
        'utf8',
      );
      const lifecycleReceipt = JSON.parse(
        readFileSync(join(value.output, 'session.xcresult.lifecycle.log.json'), 'utf8'),
      );
      assert.match(lifecycleLog, /FIXTURE_CLEANUP_COMPLETED/);
      assert.equal(lifecycleReceipt.fixtureCleanupState, 'completed');
      const fresh = profile === 'fixtures' ? 1 : identifiers.length;
      assert.equal(value.calls.filter((call) => call.args[1] === 'keychain').length, fresh);
      assert.equal(value.calls.filter((call) => call.args[1] === 'uninstall').length, fresh);
      assert.deepEqual(
        value
          .report()
          .observations.map((item) => item.identifier)
          .sort(),
        identifiers.slice().sort(),
      );
    } finally {
      value.dispose();
    }
  });
}

test('an unrecognized callback cannot prepare a fixture or turn a raw runner failure into success', () => {
  const value = fixture({ invalidRequest: true, failFirst: false });
  try {
    assert.notEqual(value.outcome.status, 0);
    assert.equal(
      value.calls.filter((call) =>
        ['install', 'keychain', 'uninstall', 'privacy', 'launch'].includes(call.args[1]),
      ).length,
      0,
    );
    assert.deepEqual(value.report().notRun, value.identifiers);
    assert.equal(value.report().passed, false);
    assert.match(value.report().session.failure, /Unknown fixture session case or stage/);
  } finally {
    value.dispose();
  }
});

test('cancellation cannot accept already passed cases from the runner', () => {
  const value = fixture({ failFirst: false, cancelAfterComplete: true });
  try {
    assert.notEqual(value.outcome.status, 0);
    const report = value.report();
    assert.ok([0, 1].includes(report.session.status));
    assert.match(report.session.failure, /cancelled by SIGTERM/);
    assert.equal(report.observations.length, value.identifiers.length);
    assert.equal(report.passed, false);
  } finally {
    value.dispose();
  }
});

test('a consumed prepare token cannot be reused for a completion or leave the session silently waiting', () => {
  const value = fixture({ failFirst: false, replayToken: true });
  try {
    assert.notEqual(value.outcome.status, 0);
    assert.match(value.report().session.failure, /token reused for a different boundary/);
    assert.deepEqual(value.report().notRun, value.identifiers.slice(1));
    assert.equal(value.calls.filter((call) => call.name === 'xcodebuild').length, 1);
  } finally {
    value.dispose();
  }
});

test('preparation follows the actual XCTest order rather than assuming the selection order', () => {
  const identifiers = iosTestInventory('fixtures', 'recordings').slice(0, 3);
  const value = fixture({ selectedIdentifiers: identifiers, failFirst: false, reverse: true });
  try {
    assert.equal(value.outcome.status, 0, value.outcome.stderr);
    assert.deepEqual(
      value.report().observations.map((item) => item.identifier),
      identifiers.slice().reverse(),
    );
    assert.equal(value.calls.filter((call) => call.args[1] === 'privacy').length, 4);
  } finally {
    value.dispose();
  }
});

test('module-qualified XCTest names still map only to the selected exact inventory', () => {
  const value = fixture({ failFirst: false, qualifiedName: true });
  try {
    assert.equal(value.outcome.status, 0, value.outcome.stderr);
    assert.deepEqual(value.report().notRun, []);
  } finally {
    value.dispose();
  }
});

// This child is the direct session child, so its graceful exit zero is observed without a shell/tee signal result.
test('the actual session preserves cancellation when its direct child handles SIGTERM with exit zero', () => {
  const modulePath = resolve('scripts/ci/ios-test-fixture-session.mjs');
  const child = `process.on('SIGTERM',()=>process.exit(0));process.kill(process.ppid,'SIGTERM');setInterval(()=>{},1000);`;
  const program = `import {executeIosFixtureSession} from ${JSON.stringify(modulePath)};const result=await executeIosFixtureSession({identifiers:['OrotUITests/ControlledTests/testCase'],command:[process.execPath,'-e',${JSON.stringify(child)}],handle:()=>{throw new Error('No case was requested');}});console.log(JSON.stringify(result));`;
  const outcome = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
    encoding: 'utf8',
  });
  assert.equal(outcome.status, 0, outcome.stderr);
  const result = JSON.parse(outcome.stdout.trim());
  assert.equal(result.status, 0);
  assert.match(result.failure, /cancelled by SIGTERM/);
  assert.deepEqual(result.entered, []);
});

test('a valid common session cannot absorb Backup snapshot seed, recovery or a mixed transfer selection', () => {
  const ids = iosTestInventory('backup');
  const session = { TEST_RUNNER_OROT_IOS_FIXTURE_SESSION: '11111111-2222-4333-8444-555555555555' };
  for (const selected of [[ids[3]], [ids[4]], [ids[0], ids[3]]]) {
    const value = runnerFixture(0, 'backup', 'all', selected, session);
    try {
      assert.notEqual(value.outcome.status, 0);
      assert.match(value.outcome.stderr, /isolated host-orchestrated phases/);
      assert.equal(value.calls.filter((call) => call.name === 'xcodebuild').length, 0);
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  }
  const value = fixture({ profile: 'backup', selectedIdentifiers: [ids[3]], failFirst: false });
  try {
    assert.notEqual(value.outcome.status, 0);
    assert.match(value.outcome.stderr, /only independent fresh-container cases/);
    assert.equal(value.calls.filter((call) => call.name === 'xcodebuild').length, 0);
  } finally {
    value.dispose();
  }
});
