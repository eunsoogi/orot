import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { iosTestConfig } from '../ios-test-config.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { createProductFixture } from './ios-test-products-fixture.mjs';

// These CLI fixtures reproduce scheduling and ownership; they prove no native UI acceptance.
function fixture({ failFirst = true, cleanupFailure = false } = {}) {
  const repository = process.cwd();
  const value = createProductFixture('fixtures');
  const spec = iosTestConfig('fixtures');
  const owner = {
    ...spec,
    name: 'owned-continuation-fixture',
    udid: '11111111-2222-4333-8444-555555555555',
  };
  const identifiers = iosTestInventory('fixtures', 'calendar').slice(-2);
  const trace = join(value.root, 'calls.jsonl');
  const installed = join(value.root, 'installed.flag');
  const ownerFile = join(value.root, 'owner.json');
  writeFileSync(ownerFile, JSON.stringify(owner));
  const output = join(value.root, 'results');
  const program = `#!${process.execPath}
const fs=require('node:fs');const path=require('node:path');const args=process.argv.slice(2);const name=path.basename(process.argv[1]);
fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({name,args})+'\\n');
if(name==='xcodebuild'){
 const identifier=args.find(x=>x.startsWith('-only-testing:')).slice(14);
 const result=args[args.indexOf('-resultBundlePath')+1]; fs.mkdirSync(result); fs.writeFileSync(path.join(result,'identifier'),identifier);
 process.exit(${failFirst}&&identifier===${JSON.stringify(identifiers[0])}?65:0);
}
if(name!=='xcrun'){console.log('synthetic resource sample');process.exit(0);}
if(args[0]==='xcresulttool'){
 if(args[1]==='export'){fs.mkdirSync(args[args.indexOf('--output-path')+1],{recursive:true});process.exit(0);}
 const result=args[args.indexOf('--path')+1];const identifier=fs.readFileSync(path.join(result,'identifier'),'utf8');
 console.log(JSON.stringify({testNodes:[{nodeType:'UI test bundle',name:'OrotUITests',children:[{nodeType:'Test Case',nodeIdentifier:identifier.split('/').slice(1).join('/')+'()',result:'Passed'}]}]}));process.exit(0);
}
if(args[1]==='list'&&args[2]==='runtimes'){console.log(JSON.stringify({runtimes:[{identifier:${JSON.stringify(spec.runtime)},buildversion:${JSON.stringify(spec.runtimeBuild)},isAvailable:true}]}));process.exit(0);}
if(args[1]==='list'&&args[2]==='devices'){console.log(JSON.stringify({devices:{[${JSON.stringify(spec.runtime)}]:[{udid:${JSON.stringify(owner.udid)},name:${JSON.stringify(owner.name)},deviceTypeIdentifier:${JSON.stringify(spec.device)},state:'Booted'}]}}));process.exit(0);}
if(args[1]==='get_app_container'){if(fs.existsSync(${JSON.stringify(installed)})){console.log('/synthetic/owned/Orot.app');process.exit(0);}console.error('domain=NSPOSIXErrorDomain, code=2');process.exit(2);}
if(args[1]==='install')fs.writeFileSync(${JSON.stringify(installed)},'installed');
if(args[1]==='uninstall'&&!${cleanupFailure})fs.rmSync(${JSON.stringify(installed)});
console.log('synthetic owned fixture operation');
`;
  for (const name of ['xcrun', 'xcodebuild', 'ps', 'vm_stat', 'sysctl'])
    writeFileSync(join(value.root, 'bin', name), program, { mode: 0o755 });
  mkdirSync(join(value.products, 'Release-iphonesimulator', 'Orot.app'), { recursive: true });
  const outcome = spawnSync(
    process.execPath,
    [
      resolve(repository, 'scripts/ci/run-ios-fixture-tests.mjs'),
      'fixtures',
      join(value.products, 'OrotTests_iphonesimulator27.0-arm64.xctestrun'),
      ownerFile,
      output,
      ...identifiers,
    ],
    { cwd: repository, env: value.env, encoding: 'utf8' },
  );
  const calls = readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse);
  return {
    ...value,
    outcome,
    calls,
    identifiers,
    output,
    report: () => JSON.parse(readFileSync(join(output, 'results.json'), 'utf8')),
  };
}

test('a failed first case stays failed while the next isolated case executes exactly once', () => {
  const value = fixture();
  try {
    assert.notEqual(value.outcome.status, 0);
    const executions = value.calls.filter((call) => call.name === 'xcodebuild');
    assert.deepEqual(
      executions.map((call) => call.args.find((arg) => arg.startsWith('-only-testing:')).slice(14)),
      value.identifiers,
    );
    const report = value.report();
    assert.equal(report.passed, false);
    assert.equal(report.failures[0].identifier, value.identifiers[0]);
    assert.deepEqual(
      report.observations.map((item) => item.identifier),
      [value.identifiers[1]],
    );
    assert.equal(value.calls.filter((call) => call.args[1] === 'keychain').length, 2);
    assert.equal(value.calls.filter((call) => call.args[1] === 'uninstall').length, 2);
  } finally {
    value.dispose();
  }
});

test('unverified cleanup stops before any later case or success report', () => {
  const value = fixture({ cleanupFailure: true });
  try {
    assert.notEqual(value.outcome.status, 0);
    assert.match(value.outcome.stderr, /remained after cleanup/);
    assert.equal(value.calls.filter((call) => call.name === 'xcodebuild').length, 1);
    assert.ok(!existsSync(join(value.output, 'results.json')));
  } finally {
    value.dispose();
  }
});

test('all successful first cases retain their complete exact observation list', () => {
  const value = fixture({ failFirst: false });
  try {
    assert.equal(value.outcome.status, 0, value.outcome.stderr);
    assert.deepEqual(
      value.report().observations.map((item) => item.identifier),
      value.identifiers,
    );
  } finally {
    value.dispose();
  }
});
