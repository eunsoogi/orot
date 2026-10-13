import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { iosTestConfig } from './ios-test-config.mjs';
import { iosTestInventory } from './ios-test-inventory.mjs';
import { verifyIosTestSimulator } from './ios-test-simulator.mjs';
import { verifyTestRunContract } from './ios-test-run-contract.mjs';
import { verifyIosTestResults } from './ios-test-results.mjs';
import { resetIosTestFixtureContainer } from './ios-test-fixture-container.mjs';

const [profile, runFile, ownerFile, output, ...selected] = process.argv.slice(2);
if (
  !['fixtures', 'health-import'].includes(profile) ||
  !output ||
  !existsSync(runFile) ||
  existsSync(output)
)
  throw new Error(
    'Fresh fixture execution requires its profile, products, ownership and new evidence directory',
  );
const spec = iosTestConfig(profile);
const inventory = iosTestInventory(profile);
if (
  new Set(selected).size !== selected.length ||
  selected.some((identifier) => !inventory.includes(identifier))
)
  throw new Error('Unknown or repeated fresh fixture selection');
const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
if (verifyIosTestSimulator(owner, profile).state !== 'Booted')
  throw new Error('Fresh fixtures require their booted owned destination');
const runData = JSON.parse(
  execFileSync('plutil', ['-convert', 'json', '-o', '-', runFile], { encoding: 'utf8' }),
);
verifyTestRunContract(runData, spec);
const app = join(dirname(resolve(runFile)), spec.configuration + '-iphonesimulator', spec.appName);
if (!existsSync(app)) throw new Error('The verified fixture application is missing');
const directory = resolve(output);
mkdirSync(directory, { recursive: true });
const expected = selected.length ? selected : inventory;
const observations = [];
const started = Date.now();
for (const [index, identifier] of expected.entries()) {
  // Independent schema, form and import fixtures never share a prior database or its initialization marker.
  resetIosTestFixtureContainer(profile, owner, app);
  const name = String(index + 1).padStart(2, '0');
  const resultBundle = join(directory, name + '.xcresult');
  execFileSync(
    'scripts/ci/run-command.sh',
    [
      'fixture-phase-' + name,
      join(directory, name + '.log'),
      '--',
      process.execPath,
      'scripts/ci/run-ios-tests.mjs',
      profile,
      runFile,
      ownerFile,
      resultBundle,
      identifier,
    ],
    { stdio: 'inherit' },
  );
  const report = JSON.parse(
    execFileSync(
      'xcrun',
      ['xcresulttool', 'get', 'test-results', 'tests', '--path', resultBundle, '--compact'],
      { encoding: 'utf8' },
    ),
  );
  observations.push(...verifyIosTestResults(report, [identifier]));
  execFileSync('xcrun', [
    'xcresulttool',
    'export',
    'attachments',
    '--path',
    resultBundle,
    '--output-path',
    join(directory, name + '-attachments'),
  ]);
}
if (observations.length !== expected.length)
  throw new Error('Fresh fixture inventory is incomplete');
writeFileSync(
  join(directory, 'results.json'),
  JSON.stringify(
    {
      profile,
      suite: selected.length ? 'selected' : 'all',
      observations,
      elapsedMs: Date.now() - started,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `IOS_FIXTURE_RESULTS_VERIFIED passed=${observations.length} elapsed_ms=${Date.now() - started}`,
);
