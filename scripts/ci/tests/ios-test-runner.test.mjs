import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { iosTestConfig } from '../ios-test-config.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

// Executable fixtures exercise CLI exit propagation without booting a simulator or invoking Xcode.
function fixture(status, profile = 'core', suite = 'all', selected) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-test-runner-'));
  const spec = iosTestConfig(profile);
  const owner = { ...spec, name: 'owned-fixture', udid: 'fixture-udid' };
  const calls = join(directory, 'calls.jsonl');
  const program = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const name = require('node:path').basename(process.argv[1]);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({name,args,invocation:process.env.TEST_RUNNER_OROT_IOS_TEST_INVOCATION})+'\\n');
if (name === 'xcodebuild') process.exit(${status});
if (args[1] === 'list' && args[2] === 'runtimes') console.log(JSON.stringify({runtimes:[{identifier:${JSON.stringify(spec.runtime)},buildversion:${JSON.stringify(spec.runtimeBuild)},isAvailable:true}]}));
else if (args[1] === 'list' && args[2] === 'devices') console.log(JSON.stringify({devices:{[${JSON.stringify(spec.runtime)}]:[{udid:'fixture-udid',name:'owned-fixture',deviceTypeIdentifier:${JSON.stringify(spec.device)},state:'Booted'}]}}));
else console.log('fixture app diagnostic');
`;
  for (const name of ['xcrun', 'xcodebuild', 'vm_stat', 'sysctl', 'ps'])
    writeFileSync(join(directory, name), program, { mode: 0o755 });
  const ownerFile = join(directory, 'owner.json');
  const runFile = join(directory, 'products.xctestrun');
  const result = join(directory, 'result.xcresult');
  writeFileSync(ownerFile, JSON.stringify(owner));
  writeFileSync(runFile, 'fixture products');
  const outcome = spawnSync(
    process.execPath,
    [
      resolve('scripts/ci/run-ios-tests.mjs'),
      profile,
      runFile,
      ownerFile,
      result,
      ...(selected ??
        (profile === 'core'
          ? [
              'OrotUITests/PersistenceUITests/testUtf8CheckpointResumesWithoutRepeatingCompletedNode',
            ]
          : [])),
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, OROT_IOS_TEST_SUITE: suite, PATH: directory + ':' + process.env.PATH },
    },
  );
  return {
    directory,
    outcome,
    calls: readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse),
    result,
  };
}

test('backup mutations cannot run as a shared Core selection or an unsequenced backup suite', () => {
  for (const [profile, selected] of [
    ['core', [iosTestInventory('backup')[0]]],
    ['backup', []],
  ]) {
    const result = fixture(0, profile, 'all', selected);
    try {
      assert.notEqual(result.outcome.status, 0);
      assert.match(result.outcome.stderr, /isolated host-orchestrated phases/);
      assert.ok(!result.calls.some((call) => call.name === 'xcodebuild'));
    } finally {
      rmSync(result.directory, { recursive: true, force: true });
    }
  }
  const allowed = fixture(0, 'backup', 'all', [iosTestInventory('backup')[0]]);
  try {
    assert.equal(allowed.outcome.status, 0, allowed.outcome.stderr);
    assert.equal(allowed.calls.filter((call) => call.name === 'xcodebuild').length, 1);
  } finally {
    rmSync(allowed.directory, { recursive: true, force: true });
  }
});

for (const suite of ['native', 'ui']) {
  test(`executes the mandatory Speech ${suite} inventory once on its own runner`, () => {
    const result = fixture(0, 'speech', suite);
    try {
      assert.equal(result.outcome.status, 0, result.outcome.stderr);
      const runs = result.calls.filter((call) => call.name === 'xcodebuild');
      assert.equal(runs.length, 1);
      assert.deepEqual(
        runs[0].args.filter((arg) => arg.startsWith('-only-testing:')),
        iosTestInventory('speech', suite).map((id) => '-only-testing:' + id),
      );
    } finally {
      rmSync(result.directory, { recursive: true, force: true });
    }
  });
}

for (const status of [0, 65]) {
  test(`preserves first test exit ${status} with one runner and bounded failure diagnostics`, () => {
    const result = fixture(status);
    try {
      assert.equal(result.outcome.status, status, result.outcome.stderr);
      const runs = result.calls.filter((call) => call.name === 'xcodebuild');
      assert.equal(runs.length, 1);
      assert.equal(runs[0].args[0], 'test-without-building');
      assert.equal(runs[0].args[runs[0].args.indexOf('-collect-test-diagnostics') + 1], 'never');
      assert.equal(runs[0].args[runs[0].args.indexOf('-parallel-testing-enabled') + 1], 'NO');
      assert.ok(!runs[0].args.some((arg) => arg.includes('retry')));
      const diagnostics = result.calls.filter((call) => call.args.includes('show'));
      assert.equal(diagnostics.length, status === 0 ? 0 : 1);
      if (status !== 0)
        assert.match(readFileSync(result.result + '.app.log', 'utf8'), /fixture app diagnostic/);
      const samples = readFileSync(result.result + '.resources.jsonl', 'utf8')
        .trim()
        .split('\n')
        .map(JSON.parse);
      assert.deepEqual(
        samples.map((sample) => sample.stage),
        ['before', 'after'],
      );
      assert.match(
        result.outcome.stdout,
        new RegExp(`IOS_TEST_STAGE elapsed_ms=\\d+ exit=${status}`),
      );
    } finally {
      rmSync(result.directory, { recursive: true, force: true });
    }
  });
}

test('failure log collection has a finite budget and cannot replace the test exit', () => {
  const source = readFileSync(resolve('scripts/ci/run-ios-tests.mjs'), 'utf8');
  assert.match(source, /timeout: 30000/);
  assert.match(source, /process\.exitCode = status/);
});

test('fresh fixture selections cannot mutate Core or bypass their phase inventory', () => {
  for (const fixtureProfile of ['fixtures', 'health-import', 'microphone', 'provider-selection']) {
    const identifier = iosTestInventory(fixtureProfile)[0];
    for (const [profile, selected] of [
      ['core', [identifier]],
      [fixtureProfile, []],
      [fixtureProfile, [identifier, iosTestInventory(fixtureProfile)[1]]],
      [fixtureProfile, ['OrotUITests/UnknownTests/testUnknown']],
    ]) {
      const result = fixture(0, profile, 'all', selected);
      try {
        assert.notEqual(result.outcome.status, 0);
        assert.match(result.outcome.stderr, /dedicated host-orchestrated destination/);
        assert.ok(!result.calls.some((call) => call.name === 'xcodebuild'));
      } finally {
        rmSync(result.directory, { recursive: true, force: true });
      }
    }
    const allowed = fixture(0, fixtureProfile, 'all', [identifier]);
    try {
      assert.equal(allowed.outcome.status, 0, allowed.outcome.stderr);
      assert.equal(allowed.calls.filter((call) => call.name === 'xcodebuild').length, 1);
    } finally {
      rmSync(allowed.directory, { recursive: true, force: true });
    }
  }
});

test('fresh-install storage refuses shared Core state and runs only as an isolated fixture phase', () => {
  // The original storage requirement resets the app and Keychain before creation, then preserves both only for its in-case restart.
  const identifier =
    'OrotUITests/PersistenceUITests/testEncryptedSourceAndEvidenceSurviveProcessRestart';
  const shared = fixture(0, 'core', 'all', [identifier]);
  try {
    assert.notEqual(shared.outcome.status, 0);
    assert.match(shared.outcome.stderr, /dedicated host-orchestrated destination/);
    assert.ok(!shared.calls.some((call) => call.name === 'xcodebuild'));
  } finally {
    rmSync(shared.directory, { recursive: true, force: true });
  }
  const isolated = fixture(0, 'fixtures', 'all', [identifier]);
  try {
    assert.equal(isolated.outcome.status, 0, isolated.outcome.stderr);
    assert.equal(isolated.calls.filter((call) => call.name === 'xcodebuild').length, 1);
  } finally {
    rmSync(isolated.directory, { recursive: true, force: true });
  }
});

test('local model selection requires exactly one corpus phase on its dedicated destination', () => {
  const identifier = iosTestInventory('local-model')[0];
  for (const [profile, selected] of [
    ['core', [identifier]],
    ['local-model', []],
    ['local-model', [identifier, iosTestInventory('local-model')[1]]],
    ['local-model', ['OrotIntegrationTests/UnknownTests/testUnknown']],
  ]) {
    const result = fixture(0, profile, 'all', selected);
    try {
      assert.notEqual(result.outcome.status, 0);
      assert.match(result.outcome.stderr, /isolated corpus and process phases/);
      assert.ok(!result.calls.some((call) => call.name === 'xcodebuild'));
    } finally {
      rmSync(result.directory, { recursive: true, force: true });
    }
  }
  const allowed = fixture(65, 'local-model', 'all', [identifier]);
  try {
    assert.equal(allowed.outcome.status, 65, allowed.outcome.stderr);
    assert.equal(allowed.calls.filter((call) => call.name === 'xcodebuild').length, 1);
  } finally {
    rmSync(allowed.directory, { recursive: true, force: true });
  }
});

test('each runner invocation creates a fresh namespace and refuses a mixed native/UI selection', () => {
  const first = fixture(0);
  const second = fixture(0);
  const mixed = fixture(0, 'core', 'all', iosTestInventory('core'));
  try {
    const invocations = [first, second].map((result) => {
      assert.equal(result.outcome.status, 0, result.outcome.stderr);
      const run = result.calls.find((call) => call.name === 'xcodebuild');
      assert.match(
        run.invocation,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      return run.invocation;
    });
    assert.notEqual(invocations[0], invocations[1]);
    assert.notEqual(mixed.outcome.status, 0);
    assert.match(mixed.outcome.stderr, /separate verified invocations/);
    assert.ok(!mixed.calls.some((call) => call.name === 'xcodebuild'));
  } finally {
    for (const result of [first, second, mixed])
      rmSync(result.directory, { recursive: true, force: true });
  }
});
