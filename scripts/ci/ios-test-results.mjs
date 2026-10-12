import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iosTestInventory } from './ios-test-inventory.mjs';

export function verifyIosTestResults(report, expected) {
  if (!Array.isArray(report.testNodes) || !expected.length)
    throw new Error('Native results require an explicit expected test inventory');
  const observations = [];
  function visit(node, target) {
    if (
      node.nodeType === 'Repetition' ||
      (node.nodeType === 'Test Case Run' && node.result !== 'Passed')
    )
      throw new Error('Native results contain a retry or unsuccessful individual execution');
    const currentTarget = ['Unit test bundle', 'UI test bundle'].includes(node.nodeType)
      ? node.name
      : target;
    if (node.nodeType === 'Test Case') {
      const identifier = node.nodeIdentifier?.replace(/\(\)$/, '');
      // xcresult identifiers may omit the target; recover it only from the reported suite.
      const full =
        identifier?.split('/').length === 2 ? currentTarget + '/' + identifier : identifier;
      observations.push({
        identifier: full,
        result: node.result,
        duration: node.durationInSeconds,
      });
    }
    for (const child of node.children ?? []) visit(child, currentTarget);
  }
  report.testNodes.forEach((node) => visit(node, undefined));
  if (
    observations.length !== expected.length ||
    new Set(observations.map((item) => item.identifier)).size !== expected.length
  )
    throw new Error('Missing, unexpected or repeated native test execution');
  for (const test of expected) {
    const result = observations.find((item) => item.identifier === test);
    if (!result || result.result !== 'Passed')
      throw new Error('Native test did not pass on its first execution: ' + test);
  }
  return observations;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [profile, bundle, output, ...selected] = process.argv.slice(2);
  const expected = selected.length ? selected : iosTestInventory(profile);
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
    JSON.stringify({ profile, observations, devices: report.devices }, null, 2) + '\n',
  );
  console.log(`IOS_TEST_RESULTS_VERIFIED profile=${profile} passed=${observations.length}`);
}
