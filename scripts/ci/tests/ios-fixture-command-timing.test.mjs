import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { iosTestConfig } from '../ios-test-config.mjs';

// Reproduce the hosted boundary: public preparation can consume ten seconds before the launched app can write anything.
function fixture({
  slowPreparation = false,
  missingReceipt = false,
  slowReceipt = false,
  receiptDelayMs = slowReceipt ? 10100 : 200,
  tracePidChecks = false,
  releaseReceiptAfterPidChecks = 0,
}) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-fixture-receipt-timing-'));
  const spec = iosTestConfig('fixtures');
  const owner = { ...spec, name: 'owned-timing-fixture', udid: 'owned-device' };
  const container = join(directory, 'data');
  const trace = join(directory, 'commands.jsonl');
  const pidProbeTrace = join(directory, 'pid-probes.jsonl');
  const processHook = join(directory, 'trace-pid-probes.cjs');
  const appPidFile = join(directory, 'app-pid');
  const receiptReleaseMarker = join(directory, 'receipt-release');
  const receiptProducer =
    releaseReceiptAfterPidChecks > 0
      ? `const gate=setInterval(()=>{if(fs.existsSync(${JSON.stringify(receiptReleaseMarker)})){clearInterval(gate);fs.writeFileSync(__FILE__,JSON.stringify({...__RECEIPT__,processIdentifier:process.pid}));}},10);`
      : `setTimeout(()=>{fs.writeFileSync(__FILE__,JSON.stringify({...__RECEIPT__,processIdentifier:process.pid}));},${receiptDelayMs});`;
  const childSourceTemplate = missingReceipt
    ? ''
    : `const fs=require("node:fs");${receiptProducer}setInterval(()=>{},1000)`;
  mkdirSync(container);
  if (tracePidChecks)
    writeFileSync(
      processHook,
      `const fs=require('node:fs');const original=process.kill.bind(process);let appPid,checks=0;process.kill=(pid,signal)=>{if(signal===0){if(!appPid&&fs.existsSync(process.env.OROT_FIXTURE_APP_PID))appPid=fs.readFileSync(process.env.OROT_FIXTURE_APP_PID,'utf8');if(String(pid)===appPid){checks++;fs.appendFileSync(process.env.OROT_FIXTURE_PID_PROBE_TRACE,String(pid)+'\\n');const releaseAfter=Number(process.env.OROT_FIXTURE_RELEASE_AFTER_PID_CHECKS||0);if(releaseAfter>0&&checks>=releaseAfter&&!fs.existsSync(process.env.OROT_FIXTURE_RECEIPT_RELEASE))fs.writeFileSync(process.env.OROT_FIXTURE_RECEIPT_RELEASE,'ready');}}return original(pid,signal);};`,
    );
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
    preferences: {
      OrotFixturePollution: false,
      'com.orot.provider.openai.ext-agent-host-id': false,
    },
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
if(args[1]==='launch') {
 const folder=path.join(${JSON.stringify(container)},'Library/Caches/OrotFixtureReceipts');fs.mkdirSync(folder,{recursive:true});
 const file=path.join(folder,args.at(-1)+'-'+args.at(-2)+'.json');
 const receipt={token:args.at(-1),action:args.at(-2),ok:true,state:${JSON.stringify(state)}};
 const source=${JSON.stringify(childSourceTemplate)}.replaceAll('__FILE__',JSON.stringify(file)).replaceAll('__RECEIPT__',JSON.stringify(receipt));
 const child=cp.spawn(process.execPath,['-e',source],{detached:true,stdio:'ignore'});child.unref();
 fs.writeFileSync(${JSON.stringify(appPidFile)},String(child.pid));
 console.log('com.orot.mobile: '+child.pid);
}
if(args[1]==='terminate') {
 try{process.kill(Number(fs.readFileSync(${JSON.stringify(join(directory, 'app-pid'))},'utf8')),'SIGTERM');}
 catch(error){if(error.code!=='ESRCH')throw error;}
}
`,
    { mode: 0o755 },
  );
  const module = pathToFileURL(resolve('scripts/ci/ios-test-scoped-reset.mjs')).href;
  const started = Date.now();
  const outcome = spawnSync(
    process.execPath,
    [
      ...(tracePidChecks ? ['--require', processHook] : []),
      '--input-type=module',
      '--eval',
      `import {runIosFixtureCommand} from ${JSON.stringify(module)};console.log(JSON.stringify(await runIosFixtureCommand('fixtures',${JSON.stringify(owner)},'reset')));`,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...(tracePidChecks
          ? {
              OROT_FIXTURE_PID_PROBE_TRACE: pidProbeTrace,
              OROT_FIXTURE_APP_PID: appPidFile,
              OROT_FIXTURE_RELEASE_AFTER_PID_CHECKS: String(releaseReceiptAfterPidChecks),
              OROT_FIXTURE_RECEIPT_RELEASE: receiptReleaseMarker,
            }
          : {}),
        PATH: directory + ':' + process.env.PATH,
      },
    },
  );
  return {
    outcome,
    elapsedMs: Date.now() - started,
    calls: readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse),
    pidChecks: existsSync(pidProbeTrace)
      ? readFileSync(pidProbeTrace, 'utf8').trim().split('\n').filter(Boolean).length
      : 0,
    dispose: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test('slow preparation waits for the actual launched app receipt', async () => {
  const value = fixture({ slowPreparation: true, missingReceipt: false });
  try {
    assert.equal(value.outcome.status, 0, value.outcome.stderr);
    const result = JSON.parse(value.outcome.stdout);
    assert.ok(result.preparationElapsedMs >= 10000);
    // The app may finish before launch returns on a loaded host; an already valid receipt needs no minimum wait.
    assert.ok(result.receiptElapsedMs >= 0);
    assert.equal(value.calls.filter((args) => args[1] === 'launch').length, 1);
    assert.equal(value.calls.filter((args) => args[1] === 'terminate').length, 1);
  } finally {
    // A failing pre-change run may terminate before its simulated app writes the delayed receipt.
    await new Promise((resolve) => setTimeout(resolve, 300));
    value.dispose();
  }
});

test('receipt waiting polls the child PID without rescanning Simulator inventory each time', () => {
  const value = fixture({ releaseReceiptAfterPidChecks: 4, tracePidChecks: true });
  try {
    assert.equal(value.outcome.status, 0, value.outcome.stderr);
    // The fixture releases the receipt only after the runner probes the launched PID four times.
    assert.ok(value.pidChecks >= 4, `expected repeated PID probes, saw ${value.pidChecks}`);
    // Four command boundaries plus receipt consumption each retain one fresh inventory.
    assert.equal(
      value.calls.filter((args) => args[1] === 'list').length,
      5,
      'full Simulator inventory must not run once per receipt-wait iteration',
    );
  } finally {
    value.dispose();
  }
});

test('an exited app cannot turn a missing receipt into success or relaunch', () => {
  const value = fixture({ slowPreparation: false, missingReceipt: true });
  try {
    assert.notEqual(value.outcome.status, 0);
    assert.match(value.outcome.stderr, /Scoped fixture process exited before its receipt/);
    assert.equal(value.calls.filter((args) => args[1] === 'launch').length, 1);
    assert.equal(value.calls.filter((args) => args[1] === 'terminate').length, 1);
  } finally {
    value.dispose();
  }
});

// The real host child stays alive beyond the old receipt cap, then publishes once and is explicitly terminated.
test('a slow app receipt beyond ten seconds is accepted without a replacement deadline', () => {
  const value = fixture({ slowReceipt: true });
  try {
    assert.equal(value.outcome.status, 0, value.outcome.stderr);
    assert.ok(JSON.parse(value.outcome.stdout).receiptElapsedMs >= 10000);
    assert.equal(value.calls.filter((args) => args[1] === 'launch').length, 1);
    assert.equal(value.calls.filter((args) => args[1] === 'terminate').length, 1);
  } finally {
    value.dispose();
  }
});
