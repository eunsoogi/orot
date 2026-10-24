import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { iosTestConfig } from '../../ios-test-config.mjs';
import { iosTestInventory } from '../../ios-test-inventory.mjs';
import { authDiagnosticTest } from '../../ios-auth-diagnostics.mjs';

export const authStreamCalls = (calls) =>
  calls.filter(
    ({ name, args }) => name === 'xcrun' && args.at(-1)?.includes('OROT_AUTH_DIAGNOSTIC'),
  );
export const lifecycleStreamCalls = (calls) =>
  calls.filter(
    ({ name, args }) =>
      name === 'xcrun' &&
      args[1] === 'spawn' &&
      args[4] === 'stream' &&
      !args.at(-1)?.includes('OROT_AUTH_DIAGNOSTIC'),
  );

export const authFixtureRecord = {
  event: 'start-return',
  attempt: '00000000-0000-4000-8000-000000000001',
  sequence: 3,
  uptimeSeconds: 42.5,
  applicationState: 0,
  sceneStates: [0],
  sessionRetained: true,
  continuationRetained: true,
  presentationWindowRetained: true,
  presentationWindowIsKey: true,
  started: true,
};

// Executable fixtures exercise CLI exit propagation without booting a simulator or invoking Xcode.
export function fixture(
  status,
  profile = 'core',
  suite = 'all',
  selected,
  environment = {},
  authStream = 'capture',
  lifecycleStream = 'capture',
) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-test-runner-'));
  const spec = iosTestConfig(profile);
  const owner = { ...spec, name: 'owned-fixture', udid: 'fixture-udid' };
  const calls = join(directory, 'calls.jsonl');
  const result = join(directory, 'result.xcresult');
  const auth = profile === 'provider-selection' && selected?.[0] === authDiagnosticTest;
  const requestedTests =
    selected ??
    (profile === 'core'
      ? [
          'OrotUITests/TranscriptEvidenceUITests/testNativeReviewHistoryPlaybackAndDeleteConfirmation',
        ]
      : []);
  const fixtureTests = requestedTests.length ? requestedTests : iosTestInventory(profile, suite);
  const lifecycleExpected =
    (environment.TEST_RUNNER_OROT_IOS_SIMULATOR_LIFECYCLE_EXTERNAL_CAPTURE ??
      process.env.TEST_RUNNER_OROT_IOS_SIMULATOR_LIFECYCLE_EXTERNAL_CAPTURE) !== '1' &&
    fixtureTests.some((test) => test.startsWith(spec.uiTarget + '/'));
  // Synthetic XCTest waits for collector output so scheduler load cannot race test completion.
  const program = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const name = require('node:path').basename(process.argv[1]);
const auth = ${JSON.stringify(auth)}, mode = ${JSON.stringify(authStream)}, lifecycleMode = ${JSON.stringify(lifecycleStream)};
const gate = ${JSON.stringify(join(directory, 'xcode-started'))};
const entered = ${JSON.stringify(join(directory, 'collector-entered'))};
const lifecycleReady = ${JSON.stringify(join(directory, 'lifecycle-ready'))};
const output = ${JSON.stringify(result + '.auth.jsonl')};
const recordCall = () => fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({name,args,invocation:process.env.TEST_RUNNER_OROT_IOS_TEST_INVOCATION})+'\\n');
const waitFor = (ready, done) => {
 const deadline = performance.now() + 10000;
 const check = () => {
  if (ready()) return done();
  if (performance.now() >= deadline) throw new Error('Synthetic diagnostic handshake timed out');
  setTimeout(check, 10);
 }; check();
};
if (auth && name === 'xcrun' && args.some((arg) => arg.includes('OROT_AUTH_DIAGNOSTIC'))) {
 fs.writeFileSync(entered, 'collector entered');
 if (mode !== 'capture') setInterval(() => {}, 1000);
 else waitFor(() => fs.existsSync(gate), () => {
  recordCall();
  process.stdout.write(${JSON.stringify('OROT_AUTH_DIAGNOSTIC ' + JSON.stringify(authFixtureRecord) + '\n')});
  setInterval(() => {}, 1000);
 });
} else if (name === 'xcrun' && args[1] === 'spawn' && args[4] === 'stream') {
 recordCall();
 if (lifecycleMode === 'error') {
  process.once('exit', () => fs.writeFileSync(lifecycleReady, 'failed'));
  process.stderr.write('lifecycle stream unavailable', () => { process.exitCode = 1; });
 } else {
  process.on('SIGTERM', () => process.exit(143));
  process.stdout.write('SIMULATOR_LIFECYCLE_EVENT\\n', () => fs.writeFileSync(lifecycleReady, 'captured'));
  setInterval(() => {}, 1000);
 }
} else if (name === 'xcodebuild') {
 recordCall();
 if (!auth) {
  const finish = () => process.exit(${status});
  if (${JSON.stringify(lifecycleExpected)}) waitFor(() => fs.existsSync(lifecycleReady), finish);
  else finish();
  return;
 }
 fs.writeFileSync(gate, 'Xcode started');
 waitFor(() =>
  (!${JSON.stringify(lifecycleExpected)} || fs.existsSync(lifecycleReady)) && (mode === 'held'
   ? fs.existsSync(entered)
   : fs.existsSync(output) && fs.readFileSync(output, 'utf8').includes('start-return')),
  () => process.exit(${status}));
} else {
 recordCall();
 if (args[1] === 'list' && args[2] === '-j') console.log(JSON.stringify({runtimes:[{identifier:${JSON.stringify(spec.runtime)},buildversion:${JSON.stringify(spec.runtimeBuild)},isAvailable:true}],devices:{[${JSON.stringify(spec.runtime)}]:[{udid:'fixture-udid',name:'owned-fixture',deviceTypeIdentifier:${JSON.stringify(spec.device)},state:'Booted'}]}}));
else console.log('fixture app diagnostic');
}
`;
  for (const name of ['xcrun', 'xcodebuild', 'vm_stat', 'sysctl', 'ps'])
    writeFileSync(join(directory, name), program, { mode: 0o755 });
  const ownerFile = join(directory, 'owner.json');
  const runFile = join(directory, 'products.xctestrun');
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
      ...requestedTests,
    ],
    {
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        OROT_IOS_TEST_SUITE: suite,
        PATH: directory + ':' + process.env.PATH,
        ...environment,
      },
    },
  );
  return {
    directory,
    outcome,
    calls: readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse),
    result,
  };
}
