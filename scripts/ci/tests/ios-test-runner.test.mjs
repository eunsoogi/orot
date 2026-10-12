import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { iosTestConfig } from '../ios-test-config.mjs';

// Executable fixtures exercise CLI exit propagation without booting a simulator or invoking Xcode.
function fixture(status) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-test-runner-'));
  const spec = iosTestConfig('core');
  const owner = { ...spec, name: 'owned-fixture', udid: 'fixture-udid' };
  const calls = join(directory, 'calls.jsonl');
  const program = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const name = require('node:path').basename(process.argv[1]);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({name,args})+'\\n');
if (name === 'xcodebuild') process.exit(${status});
if (args[1] === 'list' && args[2] === 'runtimes') console.log(JSON.stringify({runtimes:[{identifier:${JSON.stringify(spec.runtime)},isAvailable:true}]}));
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
      'core',
      runFile,
      ownerFile,
      result,
      'OrotUITests/PersistenceUITests/testUtf8CheckpointResumesWithoutRepeatingCompletedNode',
    ],
    { encoding: 'utf8', env: { ...process.env, PATH: directory + ':' + process.env.PATH } },
  );
  return {
    directory,
    outcome,
    calls: readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse),
    result,
  };
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
