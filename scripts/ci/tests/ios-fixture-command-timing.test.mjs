import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { iosTestConfig } from '../ios-test-config.mjs';

// Reproduce the hosted boundary: public preparation can consume ten seconds before the launched app can write anything.
function fixture({ slowPreparation, missingReceipt }) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-fixture-receipt-timing-'));
  const spec = iosTestConfig('fixtures');
  const owner = { ...spec, name: 'owned-timing-fixture', udid: 'owned-device' };
  const container = join(directory, 'data');
  const trace = join(directory, 'commands.jsonl');
  mkdirSync(container);
  const paths = ['database', 'wal', 'shm', 'recordings', 'deletions', 'exports'];
  const keys = [
    'com.orot.mobile.database-encryption-key.v1',
    'com.orot.mobile.database-initialization.v1',
    'com.orot.mobile.provider-selection.v1',
    'com.orot.provider.openai.credentials',
    'com.orot.provider.openai.simulator-fixture',
  ];
  const snapshot = {
    runtimes: [{ identifier: spec.runtime, isAvailable: true }],
    devices: {
      [spec.runtime]: [
        { udid: owner.udid, name: owner.name, deviceTypeIdentifier: spec.device, state: 'Booted' },
      ],
    },
  };
  const state = {
    paths: Object.fromEntries(paths.map((name) => [name, false])),
    keys: Object.fromEntries(keys.map((name) => [name, false])),
    keyFingerprint: null,
    preferencesEmpty: true,
    pollutedPreferencesAbsent: true,
    microphoneUndetermined: true,
    speechUndetermined: true,
  };
  writeFileSync(
    join(directory, 'xcrun'),
    `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify(args)+'\\n');
if(args[1]==='list') console.log(${JSON.stringify(JSON.stringify(snapshot))});
if(args[1]==='get_app_container') {
 if(${slowPreparation}) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10050);
 console.log(${JSON.stringify(container)});
}
if(args[1]==='launch'&&!${missingReceipt}) {
 const folder=path.join(${JSON.stringify(container)},'Library/Caches/OrotFixtureReceipts');fs.mkdirSync(folder,{recursive:true});
 const receipt={token:args.at(-1),action:args.at(-2),ok:true,processIdentifier:123,state:${JSON.stringify(state)}};
 const file=path.join(folder,receipt.token+'-'+receipt.action+'.json');
 const source='setTimeout(()=>{require("node:fs").writeFileSync('+JSON.stringify(file)+','+JSON.stringify(JSON.stringify(receipt))+')},200)';
 cp.spawn(process.execPath,['-e',source],{detached:true,stdio:'ignore'}).unref();
 console.log('com.orot.mobile: 123');
}
`,
    { mode: 0o755 },
  );
  const module = pathToFileURL(resolve('scripts/ci/ios-test-scoped-reset.mjs')).href;
  const started = Date.now();
  const outcome = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import {runIosFixtureCommand} from ${JSON.stringify(module)};console.log(JSON.stringify(await runIosFixtureCommand('fixtures',${JSON.stringify(owner)},'reset')));`,
    ],
    { encoding: 'utf8', env: { ...process.env, PATH: directory + ':' + process.env.PATH } },
  );
  return {
    outcome,
    elapsedMs: Date.now() - started,
    calls: readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse),
    dispose: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test('slow preparation cannot consume the launched app receipt observation window', async () => {
  const value = fixture({ slowPreparation: true, missingReceipt: false });
  try {
    assert.equal(value.outcome.status, 0, value.outcome.stderr);
    const result = JSON.parse(value.outcome.stdout);
    assert.ok(result.preparationElapsedMs >= 10000);
    assert.ok(result.receiptElapsedMs >= 150 && result.receiptElapsedMs < 10000);
    assert.equal(value.calls.filter((args) => args[1] === 'launch').length, 1);
    assert.equal(value.calls.filter((args) => args[1] === 'terminate').length, 1);
  } finally {
    // A failing pre-change run may terminate before its simulated app writes the delayed receipt.
    await new Promise((resolve) => setTimeout(resolve, 300));
    value.dispose();
  }
});

test('a missing receipt still fails at the unchanged ten-second observation deadline without relaunch', () => {
  const value = fixture({ slowPreparation: false, missingReceipt: true });
  try {
    assert.notEqual(value.outcome.status, 0);
    assert.match(value.outcome.stderr, /Scoped fixture receipt deadline exceeded/);
    assert.ok(value.elapsedMs >= 10000 && value.elapsedMs < 15000);
    assert.equal(value.calls.filter((args) => args[1] === 'launch').length, 1);
    assert.equal(value.calls.filter((args) => args[1] === 'terminate').length, 1);
  } finally {
    value.dispose();
  }
});
