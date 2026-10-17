import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { iosTestConfig } from '../../ios-test-config.mjs';
import { authDiagnosticTest } from '../../ios-auth-diagnostics.mjs';

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
) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-test-runner-'));
  const spec = iosTestConfig(profile);
  const owner = { ...spec, name: 'owned-fixture', udid: 'fixture-udid' };
  const calls = join(directory, 'calls.jsonl');
  const result = join(directory, 'result.xcresult');
  const auth = profile === 'provider-selection' && selected?.[0] === authDiagnosticTest;
  // The synthetic Xcode command releases stream startup, then waits for a persisted record.
  // This models an executed case independently of sibling process scheduling; held mode
  // separately exercise unavailable diagnostics without waiting for a capture that cannot occur.
  const program = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const name = require('node:path').basename(process.argv[1]);
const auth = ${JSON.stringify(auth)}, mode = ${JSON.stringify(authStream)};
const gate = ${JSON.stringify(join(directory, 'xcode-started'))};
const entered = ${JSON.stringify(join(directory, 'collector-entered'))};
const output = ${JSON.stringify(result + '.auth.jsonl')};
const recordCall = () => fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({name,args,invocation:process.env.TEST_RUNNER_OROT_IOS_TEST_INVOCATION})+'\\n');
const waitFor = (ready, done) => {
 const deadline = performance.now() + 10000;
 const check = () => {
  if (ready()) return done();
  if (performance.now() >= deadline) throw new Error('Synthetic auth handshake timed out');
  setTimeout(check, 10);
 }; check();
};
if (auth && name === 'xcrun' && args.includes('stream')) {
 fs.writeFileSync(entered, 'collector entered');
 if (mode !== 'capture') setInterval(() => {}, 1000);
 else waitFor(() => fs.existsSync(gate), () => {
  recordCall();
  process.stdout.write(${JSON.stringify('OROT_AUTH_DIAGNOSTIC ' + JSON.stringify(authFixtureRecord) + '\n')});
  setInterval(() => {}, 1000);
 });
} else if (name === 'xcodebuild') {
 recordCall();
 if (!auth) process.exit(${status});
 fs.writeFileSync(gate, 'Xcode started');
 waitFor(() => mode === 'held'
  ? fs.existsSync(entered)
  : fs.existsSync(output) && fs.readFileSync(output, 'utf8').includes('start-return'),
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
      ...(selected ??
        (profile === 'core'
          ? [
              'OrotUITests/TranscriptEvidenceUITests/testNativeReviewHistoryPlaybackAndDeleteConfirmation',
            ]
          : [])),
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
