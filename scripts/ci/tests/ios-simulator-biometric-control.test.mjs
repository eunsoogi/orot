import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deviceHubFaceIdScript,
  runDeviceHubFaceIdAction,
} from '../ios-simulator-biometric-menu.mjs';
import {
  launchFaceIdOwnerApp,
  runWithFaceIdAuthorizationInput,
} from '../ios-simulator-biometric-control.mjs';

test('Face ID setup launches the product app on its exact owned Simulator', () => {
  const owner = { udid: 'AB275C8A-0339-4668-9FA2-C9D37DD15CA6' };
  const deviceHubPath = '/Applications/Xcode_27.1.app/Contents/Applications/DeviceHub.app';
  const invocations = [];
  const output = launchFaceIdOwnerApp(owner, {
    deviceHubPath,
    execFile(command, args, options) {
      invocations.push({ command, args, options });
      return command === 'xcrun' ? 'com.orot.mobile: 26108' : '';
    },
  });

  assert.deepEqual(invocations, [
    {
      command: 'xcrun',
      args: ['simctl', 'launch', owner.udid, 'com.orot.mobile'],
      options: { encoding: 'utf8', timeout: 10_000 },
    },
    {
      command: 'open',
      args: ['-a', deviceHubPath],
      options: { encoding: 'utf8', timeout: 10_000 },
    },
  ]);
  assert.equal(output, 'com.orot.mobile: 26108');
  assert.throws(
    () =>
      launchFaceIdOwnerApp({ udid: 'booted' }, { deviceHubPath, execFile: () => 'unreachable' }),
    /verified owner Simulator UDID/,
  );
});

test('Device Hub Face ID actions require the exact owner window and documented menu items', () => {
  const script = deviceHubFaceIdScript();

  assert.match(script, /bundle identifier is "com\.apple\.dt\.Devices"/);
  assert.match(script, /window of deviceHub whose name contains simulatorName/);
  assert.match(script, /count of ownedWindows\) is not 1/);
  assert.match(script, /menu bar item "Device"/);
  assert.match(script, /menu item "Face ID"/);
  assert.match(script, /menu item "Enrolled"/);
  assert.match(script, /menu item "Authorized with Face ID"/);
  assert.match(script, /available window titles:/);
  assert.doesNotMatch(script, /simctl\s+biometric|private API/i);
});

test('Device Hub action passes the owner name as an argument and accepts a successful menu action', async () => {
  const ownerName = 'OrotTests-core-123 "quoted"';
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let invocation;
  const result = await runDeviceHubFaceIdAction(
    'enroll',
    { name: ownerName },
    {
      spawnProcess(command, args, options) {
        invocation = { command, args, options };
        queueMicrotask(() => child.emit('close', 0, null));
        return child;
      },
    },
  );

  assert.deepEqual(invocation, {
    command: 'osascript',
    args: ['-e', deviceHubFaceIdScript(), 'enroll', ownerName],
    options: { stdio: ['ignore', 'pipe', 'pipe'] },
  });
  assert.deepEqual(result, { stdout: '', stderr: '' });
});

test('a failed Device Hub process preserves its host error for fail-closed handling', async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  await assert.rejects(
    runDeviceHubFaceIdAction(
      'authorize',
      { name: 'OrotTests-core-123' },
      {
        spawnProcess() {
          queueMicrotask(() => {
            child.stderr.emit('data', Buffer.from('Accessibility is unavailable'));
            child.emit('close', 23, null);
          });
          return child;
        },
      },
    ),
    /Device Hub Face ID authorize action failed \(23\): Accessibility is unavailable/,
  );
});

test('Face ID authorization input repeats only while the protected test process is active', async () => {
  let testActive = false;
  let inputCount = 0;
  let sentCount = 0;
  let cancelled = 0;
  const outcome = await runWithFaceIdAuthorizationInput({
    runTest: async () => {
      testActive = true;
      await new Promise((resolve) => setTimeout(resolve, 30));
      testActive = false;
      return 0;
    },
    sendAuthorizationInput: async () => {
      assert.equal(testActive, true);
      inputCount += 1;
    },
    onInputSent: () => {
      sentCount += 1;
    },
    cancelTest: async () => {
      cancelled += 1;
    },
    intervalMs: 2,
  });

  assert.equal(outcome.result, 0);
  assert.equal(outcome.inputCount, inputCount);
  assert.equal(sentCount, inputCount);
  assert.ok(inputCount > 0);
  assert.equal(cancelled, 0);
});

test('a failed Device Hub action stops the protected test instead of leaving it unattended', async () => {
  let finishTest;
  let cancelled = 0;
  const runTest = new Promise((resolve) => {
    finishTest = resolve;
  });

  await assert.rejects(
    runWithFaceIdAuthorizationInput({
      runTest: () => runTest,
      sendAuthorizationInput: async () => {
        throw new Error('Face ID menu unavailable');
      },
      cancelTest: async () => {
        cancelled += 1;
        finishTest(143);
      },
      intervalMs: 2,
    }),
    /Face ID menu unavailable/,
  );

  assert.equal(cancelled, 1);
});
