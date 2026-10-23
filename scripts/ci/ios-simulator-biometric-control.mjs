import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iosTestConfig, iosXcodeDeveloperDirectory } from './ios-test-config.mjs';
import { verifyIosTestSimulator } from './ios-test-simulator.mjs';
import { runDeviceHubFaceIdAction } from './ios-simulator-biometric-menu.mjs';

/** Launch on the verified owner, then reactivate Device Hub to surface its screen. */
export function launchFaceIdOwnerApp(owner, { execFile = execFileSync, deviceHubPath } = {}) {
  if (typeof owner?.udid !== 'string' || !/^[a-f0-9-]{36}$/i.test(owner.udid))
    throw new Error('Face ID app launch requires the verified owner Simulator UDID');
  if (typeof deviceHubPath !== 'string' || !isAbsolute(deviceHubPath))
    throw new Error('Face ID app launch requires the selected Xcode Device Hub path');
  const output = execFile('xcrun', ['simctl', 'launch', owner.udid, 'com.orot.mobile'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  execFile('open', ['-a', deviceHubPath], { encoding: 'utf8', timeout: 10_000 });
  return output.trim();
}

/** Keep documented authorization input tied to the active XCTest process; the tests prove the Keychain result. */
export async function runWithFaceIdAuthorizationInput({
  runTest,
  sendAuthorizationInput,
  cancelTest = () => {},
  onInputSent = () => {},
  intervalMs = 750,
}) {
  if (
    typeof runTest !== 'function' ||
    typeof sendAuthorizationInput !== 'function' ||
    typeof cancelTest !== 'function' ||
    typeof onInputSent !== 'function' ||
    !Number.isFinite(intervalMs) ||
    intervalMs < 1
  )
    throw new Error('Face ID authorization input requires a test runner and positive interval');

  let inputCount = 0;
  let controlFailure;
  let rejectControlFailure;
  let activeAction;
  let cancelled = false;
  let matching = true;
  let testFinished = false;
  const controlFailurePromise = new Promise((_, reject) => {
    rejectControlFailure = reject;
  });
  const testPromise = Promise.resolve()
    .then(runTest)
    .then(
      (result) => {
        testFinished = true;
        return result;
      },
      (error) => {
        testFinished = true;
        throw error;
      },
    );
  const resultPromise = Promise.race([testPromise, controlFailurePromise]);
  const cancel = async (error) => {
    if (cancelled) return;
    cancelled = true;
    await cancelTest(error);
  };
  const sendMatch = () => {
    if (!matching || testFinished || activeAction) return activeAction;
    activeAction = Promise.resolve()
      .then(() => {
        if (!matching || testFinished) return;
        return sendAuthorizationInput();
      })
      .then(() => {
        // A delayed host UI action is not evidence once the protected test exits.
        if (!matching || testFinished) return;
        inputCount += 1;
        onInputSent(inputCount);
      })
      .catch((error) => {
        controlFailure = error;
        rejectControlFailure(error);
        void cancel(error);
      })
      .finally(() => {
        activeAction = undefined;
      });
    return activeAction;
  };
  let timer;

  try {
    // Observe XCTest independently so a slow first menu action cannot hide test completion.
    void sendMatch();
    timer = setInterval(() => void sendMatch(), intervalMs);
    const result = await resultPromise;
    if (result === 0 && inputCount === 0)
      throw new Error(
        'The protected Keychain suite completed without a Face ID authorization input',
      );
    return { result, inputCount };
  } finally {
    matching = false;
    clearInterval(timer);
    if (controlFailure) await cancel(controlFailure);
    if (activeAction) await activeAction;
    await testPromise.catch(() => {});
  }
}

function appendControlLog(path, text) {
  appendFileSync(path, `${new Date().toISOString()} ${text}\n`);
}

function spawnOwnedTest(command, args) {
  const child = spawn(command, args, { detached: true, stdio: 'inherit' });
  const result = new Promise((accept, reject) => {
    let settled = false;
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('close', (status, signal) => {
      if (settled) return;
      settled = true;
      accept(signal ? 128 : (status ?? 1));
    });
  });
  return {
    child,
    result,
    cancel() {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    },
  };
}

async function runAuthenticationSelection(profile, testRun, ownerPath, directory) {
  if (profile !== 'core' || !testRun || !ownerPath || !directory)
    throw new Error('Face ID automation requires the focused core test products and owner inputs');
  if (process.env.GITHUB_ACTIONS !== 'true')
    throw new Error('Automated Face ID controls are restricted to the hosted focused workflow');
  const developerDirectory = process.env.DEVELOPER_DIR;
  if (!developerDirectory || !isAbsolute(developerDirectory))
    throw new Error('Face ID automation requires the selected Xcode developer directory');
  if (developerDirectory !== iosXcodeDeveloperDirectory)
    throw new Error('Face ID automation must use the pinned Xcode 27.1 runner');
  const deviceHubPath = resolve(developerDirectory, '../Applications/DeviceHub.app');
  if (!existsSync(deviceHubPath)) throw new Error('The selected Xcode does not include Device Hub');

  const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
  const config = iosTestConfig(profile);
  if (owner.runtime !== config.runtime || owner.device !== config.device)
    throw new Error('Face ID automation owner does not match the pinned core Simulator');
  const device = verifyIosTestSimulator(owner, profile);
  if (device.state !== 'Booted')
    throw new Error('Face ID automation requires its task-owned Simulator to be booted');

  const evidenceDirectory = resolve(directory);
  mkdirSync(evidenceDirectory, { recursive: true });
  const controlLog = resolve(evidenceDirectory, 'biometric-controls.log');
  const runAction = async (action) => {
    appendControlLog(controlLog, `FACE_ID_ACTION_BEGIN action=${action} udid=${owner.udid}`);
    try {
      await runDeviceHubFaceIdAction(action, owner);
      // Authorization is recorded by onInputSent only after the active-test check.
      if (action === 'enroll')
        appendControlLog(controlLog, `FACE_ID_ACTION_SENT action=${action} udid=${owner.udid}`);
    } catch (error) {
      appendControlLog(
        controlLog,
        `FACE_ID_ACTION_FAILED action=${action} udid=${owner.udid} error=${error.message}`,
      );
      throw error;
    }
  };

  // Launch first, then reactivate Device Hub so the next menu action can find this owner's screen.
  const appLaunchOutput = launchFaceIdOwnerApp(owner, { deviceHubPath });
  appendControlLog(
    controlLog,
    `FACE_ID_OWNER_APP_LAUNCHED udid=${owner.udid} output=${appLaunchOutput.replace(/\s+/g, ' ')}`,
  );

  // The simulator was created for this run, so its Face ID enrollment starts disabled.
  await runAction('enroll');

  const testCommand = [
    'scripts/ci/run-command.sh',
    'ios-focus-tests',
    resolve(evidenceDirectory, 'tests.log'),
    '--',
    process.execPath,
    'scripts/ci/run-ios-tests.mjs',
    profile,
    testRun,
    resolve(ownerPath),
    resolve(evidenceDirectory, 'results.xcresult'),
  ];
  let ownedTest;
  const { result, inputCount } = await runWithFaceIdAuthorizationInput({
    runTest: () => {
      ownedTest = spawnOwnedTest(testCommand[0], testCommand.slice(1));
      return ownedTest.result;
    },
    sendAuthorizationInput: () => runAction('authorize'),
    cancelTest: () => ownedTest?.cancel(),
    onInputSent: (count) =>
      appendControlLog(
        controlLog,
        `FACE_ID_AUTHORIZATION_INPUT_SENT count=${count} udid=${owner.udid}`,
      ),
  });
  appendControlLog(
    controlLog,
    `FACE_ID_TEST_RESULT exit=${result} authorization_inputs=${inputCount} udid=${owner.udid}`,
  );
  if (result !== 0) process.exitCode = result;
}

const [command, profile, testRun, ownerPath, directory] = process.argv.slice(2);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (command !== 'run')
    throw new Error(
      'Usage: ios-simulator-biometric-control.mjs run <profile> <xctestrun> <owner-file> <output-directory>',
    );
  await runAuthenticationSelection(profile, testRun, ownerPath, directory);
}
