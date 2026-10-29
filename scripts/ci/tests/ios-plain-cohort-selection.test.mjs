import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { iosTestCohort, iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { hostConnectionTest } from '../ios-test-preparation-contract.mjs';
import { createProductFixture } from './ios-test-products-fixture.mjs';

for (const [cohort, count] of [
  ['core-ui', 4],
  ['health-review-ui', 8],
  ['recording-evidence', 6],
]) {
  test(`${cohort} forwards its exact subset through native execution and result verification`, () => {
    const repository = process.cwd();
    const value = createProductFixture('core');
    const definition = iosTestCohort(cohort);
    const [task] = iosTestCohortTasks(cohort);
    const owner = {
      cohort,
      profiles: definition.profiles,
      runtime: definition.config.runtime,
      device: definition.config.device,
      name: `OrotTests-cohort-${cohort}-fixture`,
      udid: '11111111-2222-4333-8444-555555555555',
    };
    const snapshot = {
      runtimes: [{ identifier: owner.runtime, isAvailable: true }],
      devices: {
        [owner.runtime]: [
          {
            udid: owner.udid,
            name: owner.name,
            deviceTypeIdentifier: owner.device,
            state: 'Booted',
          },
        ],
      },
    };
    const callsPath = join(value.root, 'calls.jsonl');
    const ownerPath = join(value.root, 'owner.json');
    const output = join(value.root, 'results');
    const runFile = join(value.products, 'OrotTests_iphonesimulator27.1-arm64.xctestrun');
    // Only Apple/resource commands are synthetic. The real coordinator, native CLI and exact result oracle execute.
    const program = `#!${process.execPath}
const fs=require('node:fs'), path=require('node:path'), args=process.argv.slice(2), name=path.basename(process.argv[1]);
fs.appendFileSync(${JSON.stringify(callsPath)},JSON.stringify({name,args})+String.fromCharCode(10));
if(name==='xcodebuild') {
 const bundle=args[args.indexOf('-resultBundlePath')+1];fs.mkdirSync(bundle);
 const ids=args.filter(x=>x.startsWith('-only-testing:')).map(x=>x.slice('-only-testing:'.length));
 fs.writeFileSync(path.join(bundle,'identifiers.json'),JSON.stringify(ids));
} else if(name==='xcrun' && args[1]==='list') console.log(${JSON.stringify(JSON.stringify(snapshot))});
else if(name==='xcrun' && args[0]==='xcresulttool' && args[1]==='get') {
 const bundle=args[args.indexOf('--path')+1], ids=JSON.parse(fs.readFileSync(path.join(bundle,'identifiers.json'),'utf8'));
 console.log(JSON.stringify({testNodes:ids.map(id=>({nodeType:'Test Case',nodeIdentifier:id+'()',result:'Passed',durationInSeconds:1}))}));
} else console.log('synthetic external observation');
`;
    try {
      writeFileSync(ownerPath, JSON.stringify(owner));
      for (const name of ['xcrun', 'xcodebuild', 'open', 'ps', 'vm_stat', 'sysctl'])
        writeFileSync(join(value.root, 'bin', name), program, { mode: 0o755 });
      const outcome = spawnSync(
        process.execPath,
        [
          resolve(repository, 'scripts/ci/run-ios-test-cohort.mjs'),
          cohort,
          runFile,
          ownerPath,
          output,
        ],
        {
          cwd: repository,
          env: {
            ...value.env,
            PROFILE: 'core',
            DEVELOPER_DIR: '/Applications/Xcode_27.1.app/Contents/Developer',
          },
          encoding: 'utf8',
          timeout: 15000,
        },
      );
      assert.equal(outcome.status, 0, `${outcome.stdout}\n${outcome.stderr}`);
      const calls = readFileSync(callsPath, 'utf8').trim().split('\n').map(JSON.parse);
      const executions = calls.filter(({ name }) => name === 'xcodebuild');
      assert.equal(executions.length, 2);
      assert.deepEqual(
        executions[0].args.filter((x) => x.startsWith('-only-testing:')),
        ['-only-testing:' + hostConnectionTest],
      );
      assert.deepEqual(
        executions[1].args.filter((x) => x.startsWith('-only-testing:')),
        task.identifiers.map((id) => '-only-testing:' + id),
      );
      const report = JSON.parse(readFileSync(join(output, 'results.json'), 'utf8'));
      assert.equal(report.passed, true);
      assert.equal(report.tasks.length, 1);
      assert.equal(report.tasks[0].observations.length, count);
      assert.deepEqual(
        report.tasks[0].observations.map(({ identifier }) => identifier),
        task.identifiers,
      );
    } finally {
      value.dispose();
    }
  });
}
