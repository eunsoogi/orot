import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { iosTestTaskNeedsUiPreparation } from './ios-test-cohorts.mjs';
import { hostConnectionTest } from './ios-test-preparation-contract.mjs';
import { verifyIosTestResults } from './ios-test-results.mjs';

/** Read the original host result instead of treating its summary JSON as the test record. */
export function readIosHostPreparationObservations(resultBundle, runXcrun = execFileSync) {
  if (!existsSync(resultBundle))
    throw new Error('iOS UI preparation did not preserve the host xcresult');
  const report = JSON.parse(
    runXcrun(
      'xcrun',
      ['xcresulttool', 'get', 'test-results', 'tests', '--path', resultBundle, '--compact'],
      { encoding: 'utf8' },
    ),
  );
  return verifyIosTestResults(report, [hostConnectionTest]);
}

/** Run one plan-derived host preparation in this process and fail closed on any old disk evidence. */
export function createIosTestUiPreparationGate({
  tasks,
  profile,
  runFile,
  ownerFile,
  resultsDirectory,
  environment = process.env,
  runPreparation,
  runXcrun = execFileSync,
}) {
  if (!Array.isArray(tasks) || typeof runPreparation !== 'function')
    throw new Error('iOS UI preparation requires a task plan and runner');
  const uiTasks = tasks.filter(iosTestTaskNeedsUiPreparation);
  if (!uiTasks.length) return () => false;
  if (!profile || !runFile || !ownerFile || !resultsDirectory)
    throw new Error('iOS UI preparation requires the verified profile and owned test inputs');

  const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
  const preparationDirectory = resolve(dirname(resolve(resultsDirectory)), 'ui-preparation');
  const preparationLog = resolve(dirname(preparationDirectory), 'ui-preparation.log');
  const serviceResult = resolve(preparationDirectory, 'host-preparation.xcresult');
  if (existsSync(preparationDirectory))
    throw new Error('Existing iOS UI preparation directory cannot be reused');

  let attempted = false;
  let complete = false;

  function verifyCurrentPreparation() {
    const bootstrapPath = resolve(preparationDirectory, 'ui-bootstrap.json');
    const hostPath = resolve(preparationDirectory, 'host-preparation.json');
    if (!existsSync(bootstrapPath) || !existsSync(hostPath))
      throw new Error('Current iOS UI preparation evidence is incomplete');
    const bootstrap = JSON.parse(readFileSync(bootstrapPath, 'utf8'));
    const host = JSON.parse(readFileSync(hostPath, 'utf8'));
    const rawObservations = readIosHostPreparationObservations(serviceResult, runXcrun);
    const hostObservation = host.observations?.[0];
    const rawObservation = rawObservations[0];
    if (
      bootstrap.profile !== profile ||
      bootstrap.udid !== owner.udid ||
      bootstrap.selectedXcodeDeveloperDirectory !== environment.DEVELOPER_DIR ||
      bootstrap.hostConnectionVerified !== true ||
      host.profile !== profile ||
      host.observations?.length !== 1 ||
      hostObservation?.identifier !== hostConnectionTest ||
      hostObservation?.result !== 'Passed' ||
      rawObservation?.identifier !== hostConnectionTest ||
      rawObservation?.result !== 'Passed'
    )
      throw new Error('Current iOS UI preparation did not verify its owned host result');
  }

  return (task) => {
    if (!uiTasks.includes(task) || complete) return false;
    if (attempted) throw new Error('The first iOS UI preparation attempt did not complete');
    attempted = true;
    runPreparation({
      profile,
      suite: uiTasks[0].suite,
      runFile,
      ownerFile,
      directory: preparationDirectory,
      log: preparationLog,
    });
    verifyCurrentPreparation();
    complete = true;
    return true;
  };
}
