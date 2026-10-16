import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { iosTestConfig } from '../ios-test-config.mjs';
import { createProductFixture } from './ios-test-products-fixture.mjs';

/** Execute the unchanged Isolation driver and real child-process failure/deadline paths, without native commands. */
function fixture({ failure = 'status', post = 'absent', ownershipDelay = 0 } = {}) {
  const repository = process.cwd();
  const value = createProductFixture('core');
  const spec = iosTestConfig('core');
  const owner = {
    ...spec,
    name: 'owned-install-fixture',
    udid: '11111111-2222-4333-8444-555555555555',
  };
  const trace = join(value.root, 'calls.jsonl');
  const attempted = join(value.root, 'install-attempted');
  const ownerFile = join(value.root, 'owner.json');
  const output = join(value.root, 'results');
  writeFileSync(ownerFile, JSON.stringify(owner));
  const program = `#!${process.execPath}
const fs=require('node:fs'), path=require('node:path'); const args=process.argv.slice(2);
const name=path.basename(process.argv[1]);
fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({name,args})+'\\n');
const attempted=fs.existsSync(${JSON.stringify(attempted)});
function hang(){process.on('SIGTERM',()=>{});setInterval(()=>{},1000);}
if(name!=='xcrun'||args[0]!=='simctl')process.exit(91);
if(args[1]==='list'){
 if(attempted && ${JSON.stringify(post)}==='owner-timeout'){hang();}
 else {
  if(attempted)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${ownershipDelay});
  console.log(JSON.stringify({runtimes:[{identifier:${JSON.stringify(spec.runtime)},isAvailable:true}],devices:{[${JSON.stringify(spec.runtime)}]:[{udid:${JSON.stringify(owner.udid)},name:attempted&&${JSON.stringify(post)}==='foreign'?'foreign':${JSON.stringify(owner.name)},deviceTypeIdentifier:${JSON.stringify(spec.device)},state:'Booted'}]}}));
 }
} else if(args[1]==='get_app_container'){
 if(attempted && ${JSON.stringify(post)}==='container-timeout'){hang();}
 else if(attempted && ${JSON.stringify(post)}==='installed')console.log('/private/diagnostic-must-not-expose/Orot.app');
 else {console.error(attempted&&${JSON.stringify(post)}==='service-error'?'Synthetic service unavailable':'domain=NSPOSIXErrorDomain, code=2');process.exit(attempted&&${JSON.stringify(post)}==='service-error'?9:2);}
} else if(args[1]==='install'){
 fs.writeFileSync(${JSON.stringify(attempted)},'attempted');
 if(${JSON.stringify(failure)}==='timeout')Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,35000);
 else if(${JSON.stringify(failure)}==='signal')process.kill(process.pid,'SIGABRT');
 else {console.error('original-install-failure');process.exit(7);}
} else process.exit(92);
`;
  for (const name of ['xcrun', 'xcodebuild'])
    writeFileSync(join(value.root, 'bin', name), program, { mode: 0o755 });
  const outcome = spawnSync(
    process.execPath,
    [
      resolve(repository, 'scripts/ci/run-ios-fixture-isolation-tests.mjs'),
      join(value.products, 'OrotTests_iphonesimulator27.0-arm64.xctestrun'),
      ownerFile,
      output,
    ],
    { cwd: repository, env: value.env, encoding: 'utf8', timeout: 42000 },
  );
  return {
    ...value,
    outcome,
    output,
    owner,
    calls: readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse),
    diagnostics: outcome.stderr
      .split('\n')
      .filter((line) => line.startsWith('IOS_PREPARATION_DIAGNOSTIC '))
      .map((line) => JSON.parse(line.slice('IOS_PREPARATION_DIAGNOSTIC '.length))),
  };
}

function assertFailureStopsIsolation(value, containerQueries) {
  assert.equal(value.outcome.status, 1, value.outcome.stderr);
  assert.equal(
    existsSync(value.output),
    false,
    'No reset, pollution, XCTest or success artifact may start',
  );
  assert.equal(value.calls.filter((call) => call.args[1] === 'install').length, 1);
  assert.equal(
    value.calls.filter((call) => call.args[1] === 'get_app_container').length,
    containerQueries,
  );
  assert.ok(
    value.calls.every(
      (call) =>
        call.name === 'xcrun' && ['list', 'get_app_container', 'install'].includes(call.args[1]),
    ),
  );
  assert.deepEqual(
    value.diagnostics.map((record) => record.event),
    ['install-failed', 'install-post-state'],
  );
  assert.equal(value.diagnostics[1].budgetMs, 5000);
  assert.ok(value.diagnostics[1].elapsedMs < 6500, JSON.stringify(value.diagnostics[1]));
}

test('failed first install records status and exactly one owned observation, without later Isolation phases', () => {
  for (const [post, state, queries] of [
    ['absent', 'absent', 2],
    ['installed', 'installed', 2],
    ['foreign', 'unknown', 1],
    ['service-error', 'unknown', 2],
  ]) {
    const value = fixture({ post });
    try {
      assertFailureStopsIsolation(value, queries);
      assert.equal(value.diagnostics[0].status, 7);
      assert.equal(value.diagnostics[1].state, state);
      assert.doesNotMatch(
        JSON.stringify(value.diagnostics),
        /diagnostic-must-not-expose|original-install-failure|Synthetic service/,
      );
      assert.match(value.outcome.stderr, /original-install-failure/);
      assert.equal(value.calls.filter((call) => call.args[1] === 'list').length, 3);
      if (queries === 2) assert.deepEqual(value.calls.at(-2).args, ['simctl', 'list', '-j']);
      assert.match(value.outcome.stderr, /status: 7/);
    } finally {
      value.dispose();
    }
  }
});

test('an actual install SIGABRT stays the primary failure after a successful diagnostic query', () => {
  const value = fixture({ failure: 'signal' });
  try {
    assertFailureStopsIsolation(value, 2);
    assert.equal(value.diagnostics[0].signal, 'SIGABRT');
    assert.equal(value.diagnostics[0].status, null);
    assert.match(value.outcome.stderr, /signal: 'SIGABRT'/);
  } finally {
    value.dispose();
  }
});

test('the actual install keeps its thirty-second SIGTERM timeout even when its post-state is installed', () => {
  const value = fixture({ failure: 'timeout', post: 'installed' });
  try {
    assertFailureStopsIsolation(value, 2);
    assert.equal(value.diagnostics[0].errorCode, 'ETIMEDOUT');
    assert.equal(value.diagnostics[0].signal, 'SIGTERM');
    assert.equal(value.diagnostics[1].state, 'installed');
    const install = value.outcome.stderr
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map(JSON.parse)
      .find((record) => record.arguments?.[0] === 'install' && record.phase === 'finished');
    assert.ok(install.elapsedMs >= 30000 && install.elapsedMs < 35000);
    assert.match(value.outcome.stderr, /code: 'ETIMEDOUT'/);
  } finally {
    value.dispose();
  }
});

test('one five-second diagnostic budget includes ownership and forcibly bounds unresponsive read-only children', () => {
  for (const [post, ownershipDelay, queries] of [
    ['owner-timeout', 0, 1],
    ['container-timeout', 3500, 2],
  ]) {
    const value = fixture({ post, ownershipDelay });
    try {
      assertFailureStopsIsolation(value, queries);
      assert.equal(value.diagnostics[0].status, 7);
      assert.equal(value.diagnostics[1].state, 'unknown');
      assert.equal(value.diagnostics[1].errorCode, 'ETIMEDOUT');
      assert.equal(value.diagnostics[1].signal, 'SIGKILL');
      assert.ok(value.diagnostics[1].elapsedMs >= 4900);
      assert.match(value.outcome.stderr, /status: 7/);
      assert.equal(value.calls.filter((call) => call.args[1] === 'list').length, 3);
    } finally {
      value.dispose();
    }
  }
});
