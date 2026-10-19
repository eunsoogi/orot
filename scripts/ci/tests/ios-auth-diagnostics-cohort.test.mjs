import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { iosTestCohort, iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { hostConnectionTest } from '../ios-test-preparation-contract.mjs';
import { createProductFixture } from './ios-test-products-fixture.mjs';

test(
  'the actual cohort and fixture drivers preserve auth diagnostics after the first Selection failure',
  { timeout: 20000 },
  () => {
    const repository = process.cwd();
    const value = createProductFixture('provider-selection');
    const definition = iosTestCohort('selection');
    const [task] = iosTestCohortTasks('selection');
    const owner = {
      cohort: 'selection',
      profiles: definition.profiles,
      runtime: definition.config.runtime,
      device: definition.config.device,
      name: 'OrotTests-cohort-selection-fixture',
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
    const record = {
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
    const callsPath = join(value.root, 'calls.jsonl');
    const installed = join(value.root, 'installed');
    const ownerPath = join(value.root, 'owner.json');
    const output = join(value.root, 'results');
    const runFile = join(value.products, 'OrotTests_iphonesimulator27.0-arm64.xctestrun');
    Object.assign(value.env, {
      PROFILE: definition.profiles[0],
      DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
      GITHUB_JOB: 'selection-test',
    });
    const hostReport = {
      testNodes: [
        {
          nodeType: 'Unit test bundle',
          name: 'OrotIntegrationTests',
          children: [
            {
              nodeType: 'Test Case',
              nodeIdentifier: hostConnectionTest.split('/').slice(1).join('/') + '()',
              result: 'Passed',
            },
          ],
        },
      ],
    };
    // Only external Apple/resource commands are synthetic. The real three-level driver chain and collector execute unchanged.
    const program = `#!${process.execPath}
const fs=require('node:fs'), path=require('node:path'), args=process.argv.slice(2), name=path.basename(process.argv[1]);
fs.appendFileSync(${JSON.stringify(callsPath)},JSON.stringify({name,args})+'\\n');
if(name==='xcodebuild') {
 const bundle=args[args.indexOf('-resultBundlePath')+1];
 if(args.includes('-only-testing:${hostConnectionTest}')){fs.mkdirSync(bundle);process.exit(0);}
 const started=Date.now();
 const identifier=${JSON.stringify(task.identifiers[0])}, session=process.env.TEST_RUNNER_OROT_IOS_FIXTURE_SESSION;
 const request=(stage,passed,done)=>{const token=require('node:crypto').randomUUID();const [target,cls,method]=identifier.split('/');let input='';const socket=require('node:net').connect(Number(process.env.TEST_RUNNER_OROT_IOS_FIXTURE_PORT),'127.0.0.1',()=>socket.write(JSON.stringify({session,token,name:'-['+target+'.'+cls+' '+method+']',stage,passed})+'\\n'));socket.on('data',x=>input+=x);socket.on('error',error=>{throw error;});socket.on('end',()=>{if(!JSON.parse(input).ok)throw new Error('Fixture boundary failed');done();});};
 const failAfterCapture=()=>{
  if(fs.existsSync(bundle+'.auth.jsonl')&&fs.readFileSync(bundle+'.auth.jsonl','utf8').includes('start-return')){
   fs.mkdirSync(bundle);fs.writeFileSync(path.join(bundle,'synthetic-result'),'first failed execution');request('complete',false,()=>process.exit(65));return;
  }
  if(Date.now()-started>10000)throw new Error('Collector did not retain its record');
  setTimeout(failAfterCapture,10);
 };request('prepare',undefined,failAfterCapture);
} else if(name==='open') process.exit(0);
else if(name!=='xcrun') console.log('synthetic resource sample');
else if(args[0]==='xcresulttool'&&args.some(argument=>argument.includes('ui-preparation'))) console.log(${JSON.stringify(JSON.stringify(hostReport))});
else if(args.includes('stream')) {
 process.stdout.write(${JSON.stringify('OROT_AUTH_DIAGNOSTIC ' + JSON.stringify(record) + '\n')});setInterval(()=>{},1000);
} else if(args[1]==='list') console.log(${JSON.stringify(JSON.stringify(snapshot))});
else if(args[1]==='get_app_container') {
 if(args[3].endsWith('.xctrunner')||fs.existsSync(${JSON.stringify(installed)}))console.log(${JSON.stringify(value.products)});
 else {console.error('domain=NSPOSIXErrorDomain, code=2');process.exit(2);}
} else if(args[1]==='install') fs.writeFileSync(${JSON.stringify(installed)},'installed');
else if(args[1]==='uninstall') fs.rmSync(${JSON.stringify(installed)},{force:true});
else console.log('synthetic owned fixture operation');
`;
    try {
      writeFileSync(
        join(value.products, 'Debug-iphonesimulator/OrotUITests-Runner.app/Info.plist'),
        JSON.stringify({ CFBundleIdentifier: 'com.orot.mobile.OrotUITests.xctrunner' }),
      );
      writeFileSync(ownerPath, JSON.stringify(owner));
      for (const name of ['xcrun', 'xcodebuild', 'open', 'ps', 'vm_stat', 'sysctl'])
        writeFileSync(join(value.root, 'bin', name), program, { mode: 0o755 });
      const outcome = spawnSync(
        process.execPath,
        [
          resolve(repository, 'scripts/ci/run-ios-test-cohort.mjs'),
          'selection',
          runFile,
          ownerPath,
          output,
        ],
        { cwd: repository, env: value.env, encoding: 'utf8', timeout: 15000 },
      );
      assert.equal(outcome.status, 1, outcome.stderr);
      const directory = join(output, task.profile + '-' + task.suite, 'phases');
      const bundle = join(directory, 'session.xcresult');
      assert.ok(
        existsSync(join(bundle, 'synthetic-result')),
        `${outcome.stdout}\n${outcome.stderr}\n${readFileSync(callsPath, 'utf8')}`,
      );
      assert.equal(
        readFileSync(join(bundle, 'synthetic-result'), 'utf8'),
        'first failed execution',
      );
      assert.deepEqual(
        readFileSync(bundle + '.auth.jsonl', 'utf8')
          .trim()
          .split('\n')
          .map(JSON.parse),
        [record],
      );
      const metadata = JSON.parse(readFileSync(bundle + '.auth.jsonl.json', 'utf8'));
      assert.equal(metadata.closed, true);
      assert.equal(metadata.complete, true);
      const result = JSON.parse(readFileSync(join(directory, 'results.json'), 'utf8'));
      assert.equal(result.passed, false);
      assert.equal(result.failures[0].identifier, task.identifiers[0]);
      assert.deepEqual(result.notRun, task.identifiers.slice(1));
      const calls = readFileSync(callsPath, 'utf8').trim().split('\n').map(JSON.parse);
      assert.equal(calls.filter((call) => call.name === 'xcodebuild').length, 2);
      assert.equal(calls.filter((call) => call.args.includes('stream')).length, 1);
      assert.equal(existsSync(installed), false);
    } finally {
      value.dispose();
    }
  },
);
