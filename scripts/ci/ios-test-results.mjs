import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iosTestInventory } from './ios-test-inventory.mjs';

/** Keep failure locations repository-relative; xcresult bundles otherwise expose ephemeral host paths. */
function repositorySourceLocation(location) {
  if (
    typeof location?.filePath !== 'string' ||
    !Number.isInteger(location.lineNumber) ||
    location.lineNumber < 1
  )
    return undefined;
  const workspace = resolve(process.env.GITHUB_WORKSPACE ?? process.cwd());
  const source = resolve(workspace, location.filePath);
  const filePath = relative(workspace, source);
  if (filePath === '..' || filePath.startsWith('..' + sep) || isAbsolute(filePath))
    return undefined;
  return { filePath: filePath.split(sep).join('/'), lineNumber: location.lineNumber };
}

/** Read first executions for diagnostics; strict acceptance remains in the separate verifier. */
export function readIosTestObservations(report) {
  if (!Array.isArray(report.testNodes))
    throw new Error('iOS results require an explicit expected test inventory');
  const observations = [];
  function descendants(node, nodeType) {
    const matches = [];
    for (const child of node.children ?? []) {
      if (child.nodeType === nodeType) matches.push(child);
      matches.push(...descendants(child, nodeType));
    }
    return matches;
  }
  function visit(node, target) {
    const currentTarget = ['Unit test bundle', 'UI test bundle'].includes(node.nodeType)
      ? node.name
      : target;
    if (node.nodeType === 'Test Case') {
      const identifier = node.nodeIdentifier?.replace(/\(\)$/, '');
      // xcresult identifiers may omit the target; recover it only from the reported suite.
      const full =
        identifier?.split('/').length === 2 ? currentTarget + '/' + identifier : identifier;
      const runs = descendants(node, 'Test Case Run');
      // A final test node can summarize a retry; retain its first failed run for diagnosis.
      const failedRun = runs.find((run) => run.result !== 'Passed');
      const observationNode = failedRun ?? node;
      const failureNode =
        descendants(observationNode, 'Failure Message')[0] ??
        descendants(node, 'Failure Message')[0];
      const observation = {
        identifier: full,
        result: failedRun?.result ?? node.result,
        duration: failedRun?.durationInSeconds ?? node.durationInSeconds,
      };
      if (failureNode) {
        const sourceLocation = repositorySourceLocation(failureNode.sourceLocation);
        observation.failure = {
          ...(typeof failureNode.name === 'string'
            ? { message: failureNode.name.slice(0, 500) }
            : {}),
          ...(sourceLocation ? { sourceLocation } : {}),
        };
      }
      observations.push(observation);
    }
    for (const child of node.children ?? []) visit(child, currentTarget);
  }
  report.testNodes.forEach((node) => visit(node, undefined));
  return observations;
}

export function verifyIosTestResults(report, expected) {
  function requireFirstAttemptOnly(node) {
    if (
      node.nodeType === 'Repetition' ||
      (node.nodeType === 'Test Case Run' && node.result !== 'Passed')
    )
      throw new Error('iOS results contain a retry or unsuccessful individual execution');
    for (const child of node.children ?? []) requireFirstAttemptOnly(child);
  }
  if (!Array.isArray(report.testNodes))
    throw new Error('iOS results require an explicit expected test inventory');
  report.testNodes.forEach((node) => requireFirstAttemptOnly(node));
  return verifyIosObservationList(readIosTestObservations(report), expected);
}

/** JSON aggregation on Linux applies the same exact first-execution oracle as the Mac xcresult exporter. */
export function verifyIosObservationList(observations, expected) {
  if (!Array.isArray(observations) || !Array.isArray(expected) || !expected.length)
    throw new Error('iOS results require an explicit expected test inventory');
  if (
    observations.length !== expected.length ||
    new Set(observations.map((item) => item.identifier)).size !== expected.length
  )
    throw new Error('Missing, unexpected or repeated integration test execution');
  for (const test of expected) {
    const result = observations.find((item) => item.identifier === test);
    if (!result || result.result !== 'Passed')
      throw new Error('iOS test did not pass on its first execution: ' + test);
  }
  return observations;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [profile, bundle, output, ...selected] = process.argv.slice(2);
  const suite = selected.length ? 'selected' : (process.env.OROT_IOS_TEST_SUITE ?? 'all');
  const expected = selected.length ? selected : iosTestInventory(profile, suite);
  const report = JSON.parse(
    execFileSync(
      'xcrun',
      ['xcresulttool', 'get', 'test-results', 'tests', '--path', bundle, '--compact'],
      { encoding: 'utf8' },
    ),
  );
  const observations = verifyIosTestResults(report, expected);
  writeFileSync(
    output,
    JSON.stringify({ profile, suite, observations, devices: report.devices }, null, 2) + '\n',
  );
  console.log(`IOS_TEST_RESULTS_VERIFIED profile=${profile} passed=${observations.length}`);
}
