import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { iosTestConfig } from '../ios-test-config.mjs';

// Public-command fixtures verify ownership and telemetry without touching a real Simulator.
function fixture(change = {}, commandFailure = false) {
  const root = mkdtempSync(join(tmpdir(), 'orot-simulator-inventory-'));
  const config = iosTestConfig('speech');
  const owner = { ...config, name: 'owned-speech-fixture', udid: 'owned-udid' };
  const runtime = {
    identifier: config.runtime,
    buildversion: config.runtimeBuild,
    isAvailable: true,
    ...change.runtime,
  };
  const device = {
    udid: owner.udid,
    name: owner.name,
    deviceTypeIdentifier: config.device,
    state: 'Booted',
    ...change.device,
  };
  const snapshot = { runtimes: [runtime], devices: { [config.runtime]: [device] } };
  const calls = join(root, 'calls.jsonl');
  writeFileSync(
    join(root, 'xcrun'),
    `#!${process.execPath}
const fs = require('node:fs'); const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
if (${commandFailure}) { console.error('synthetic command failure'); process.exit(7); }
if (JSON.stringify(args) !== JSON.stringify(['simctl', 'list', '-j'])) process.exit(9);
console.log(${JSON.stringify(JSON.stringify(snapshot))});
`,
    { mode: 0o755 },
  );
  const module = pathToFileURL(resolve('scripts/ci/ios-test-simulator.mjs')).href;
  const code = `import {verifyIosTestSimulator} from ${JSON.stringify(module)}; console.log(JSON.stringify(verifyIosTestSimulator(${JSON.stringify(owner)}, 'speech')));`;
  const outcome = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    encoding: 'utf8',
    env: { ...process.env, PATH: root + ':' + process.env.PATH },
  });
  return {
    outcome,
    device,
    calls: readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse),
    timings: outcome.stderr
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map(JSON.parse),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('one public inventory verifies the pinned runtime and exact owned device without contaminating stdout', () => {
  const value = fixture();
  try {
    assert.equal(value.outcome.status, 0, value.outcome.stderr);
    assert.deepEqual(JSON.parse(value.outcome.stdout), value.device);
    assert.deepEqual(value.calls, [['simctl', 'list', '-j']]);
    assert.deepEqual(
      value.timings.map((item) => item.phase),
      ['started', 'finished'],
    );
    assert.equal(value.timings[1].status, 0);
    assert.ok(value.timings[1].elapsedMs >= 0);
    assert.ok(Date.parse(value.timings[1].timestamp) > Date.parse(value.timings[0].timestamp));
  } finally {
    value.dispose();
  }
});

test('unavailable or changed runtime and foreign device identity remain rejected', () => {
  for (const change of [
    { runtime: { identifier: 'another-runtime' } },
    { runtime: { buildversion: 'another-build' } },
    { runtime: { isAvailable: false } },
    { device: { name: 'another-owner' } },
    { device: { udid: 'another-device' } },
    { device: { deviceTypeIdentifier: 'another-type' } },
  ]) {
    const value = fixture(change);
    try {
      assert.notEqual(value.outcome.status, 0);
      assert.equal(value.outcome.stdout, '');
      assert.match(value.outcome.stderr, /runtime is unavailable|ownership mismatch/);
      assert.deepEqual(value.calls, [['simctl', 'list', '-j']]);
    } finally {
      value.dispose();
    }
  }
});

test('command telemetry retains the actual failure status and does not recover or retry', () => {
  const value = fixture({}, true);
  try {
    assert.notEqual(value.outcome.status, 0);
    assert.equal(value.outcome.stdout, '');
    assert.match(value.outcome.stderr, /synthetic command failure/);
    assert.equal(value.calls.length, 1);
    assert.equal(value.timings[1].status, 7);
    assert.ok(value.timings[1].elapsedMs >= 0);
    assert.ok(Date.parse(value.timings[1].timestamp) > Date.parse(value.timings[0].timestamp));
  } finally {
    value.dispose();
  }
});
