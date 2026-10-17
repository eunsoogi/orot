import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

// Exercise the actual controller in a separate process so cancellation cannot signal the test harness.
function execute(child, handle = '() => {}') {
  const module = resolve('scripts/ci/ios-test-fixture-session.mjs');
  const program = `import {executeIosFixtureSession} from ${JSON.stringify(module)};
const result=await executeIosFixtureSession({identifiers:['OrotUITests/ControlledTests/testCase'],command:[process.execPath,'-e',${JSON.stringify(child)}],handle:${handle}});
console.log('TRANSPORT_RESULT '+JSON.stringify(result));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(
    result.stdout
      .split('\n')
      .find((line) => line.startsWith('TRANSPORT_RESULT '))
      .slice(17),
  );
}

test('the listener and cancellation handlers exist before the runner starts', () => {
  const result = execute(`
if(!Number(process.env.TEST_RUNNER_OROT_IOS_FIXTURE_PORT))process.exit(8);
process.on('SIGTERM',()=>process.exit(0));
process.kill(process.ppid,'SIGTERM');setInterval(()=>{},1000);`);
  assert.equal(result.status, 0);
  assert.match(result.failure, /cancelled by SIGTERM/);
  assert.deepEqual(result.entered, []);
});

test('a runner that disconnects in the middle of a request cannot leave the host waiting', () => {
  const result = execute(`
const socket=require('node:net').connect(Number(process.env.TEST_RUNNER_OROT_IOS_FIXTURE_PORT),'127.0.0.1',()=>socket.end('{'));
process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);`);
  assert.equal(result.status, 0);
  assert.match(result.failure, /disconnected before its boundary completed/);
  assert.deepEqual(result.entered, []);
});

test('malformed requests receive a failed acknowledgement and never invoke host preparation', () => {
  const result = execute(
    `
const socket=require('node:net').connect(Number(process.env.TEST_RUNNER_OROT_IOS_FIXTURE_PORT),'127.0.0.1',()=>socket.write('{\\n'));
let input='';socket.on('data',x=>input+=x);socket.on('end',()=>process.exit(JSON.parse(input).ok?9:0));`,
    '() => {throw new Error("Preparation must not execute");}',
  );
  assert.equal(result.status, 0);
  assert.match(result.failure, /SyntaxError/);
  assert.deepEqual(result.entered, []);
});
