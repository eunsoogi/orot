import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { iosTestConfig } from './ios-test-config.mjs';
import { verifyIosTestSimulator } from './ios-test-simulator.mjs';
import { verifyTestRunContract } from './ios-test-run-contract.mjs';
import { verifyIosTestResults } from './ios-test-results.mjs';
import { resetIosTestFixtureContainer } from './ios-test-fixture-container.mjs';
import { executeLocalModelPhases, readLocalModelAttachment } from './local-model-test-phases.mjs';

const [runFile, ownerFile, output] = process.argv.slice(2);
if (!output || !existsSync(runFile) || existsSync(output))
  throw new Error(
    'Local model execution requires verified products, ownership and a new evidence directory',
  );
const profile = 'local-model';
const spec = iosTestConfig(profile);
const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
const app = join(dirname(resolve(runFile)), spec.configuration + '-iphonesimulator', spec.appName);
const runData = JSON.parse(
  execFileSync('plutil', ['-convert', 'json', '-o', '-', runFile], { encoding: 'utf8' }),
);
verifyTestRunContract(runData, spec);
if (!existsSync(app)) throw new Error('The verified local model application is missing');
function verifyOwner() {
  if (verifyIosTestSimulator(owner, profile).state !== 'Booted')
    throw new Error('Local model execution requires its booted dedicated destination');
}
verifyOwner();
const directory = resolve(output);
mkdirSync(directory, { recursive: true });
let phase = 0;
const observations = [];
const started = Date.now();
const results = await executeLocalModelPhases({
  reset() {
    resetIosTestFixtureContainer(profile, owner, app);
  },
  run(identifier) {
    verifyOwner();
    const name = String(++phase).padStart(2, '0');
    const resultBundle = join(directory, name + '.xcresult');
    // Each xcodebuild invocation launches a new app-host process. The receipt's actual PID must also prove it changed.
    execFileSync(
      'scripts/ci/run-command.sh',
      [
        'local-model-phase-' + name,
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
    const attachments = join(directory, name + '-attachments');
    execFileSync('xcrun', [
      'xcresulttool',
      'export',
      'attachments',
      '--path',
      resultBundle,
      '--output-path',
      attachments,
    ]);
    return readLocalModelAttachment(attachments, identifier, owner.udid);
  },
});
writeFileSync(
  join(directory, 'results.json'),
  JSON.stringify({ profile, observations, results, elapsedMs: Date.now() - started }, null, 2) +
    '\n',
);
console.log(
  `IOS_LOCAL_MODEL_RESULTS_VERIFIED passed=${observations.length} elapsed_ms=${Date.now() - started}`,
);
