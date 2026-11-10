import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { iosTestConfig } from './ios-test-config.mjs';
import { verifyTestRunContract } from './ios-test-run-contract.mjs';
import { verifyIosTestResults } from './ios-test-results.mjs';
import { readSpeechJourneyAttachment } from './speech-journey-test-phases.mjs';
import { executeAutomaticRecapPersistencePhases } from './automatic-recap-persistence-test-phases.mjs';
import { ensureIosFixtureInstalled, runIosFixtureCommand } from './ios-test-scoped-reset.mjs';

const [runFile, ownerFile, output] = process.argv.slice(2);
if (
  !runFile ||
  !ownerFile ||
  !output ||
  !existsSync(runFile) ||
  !existsSync(ownerFile) ||
  existsSync(output)
)
  throw new Error(
    'Automatic Recap requires verified products, an owned destination and a new evidence directory',
  );
const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
const config = iosTestConfig('core');
verifyTestRunContract(
  JSON.parse(
    execFileSync('plutil', ['-convert', 'json', '-o', '-', runFile], { encoding: 'utf8' }),
  ),
  config,
);
ensureIosFixtureInstalled(
  'core',
  owner,
  join(dirname(resolve(runFile)), config.configuration + '-iphonesimulator', config.appName),
);
const directory = resolve(output);
mkdirSync(directory, { recursive: true });
const observations = [];
const started = Date.now();
const { TEST_RUNNER_OROT_AUTOMATIC_RECAP_BASELINE: ignoredBaseline, ...baseEnvironment } =
  process.env;
void ignoredBaseline;
let index = 0;
let receipts;
let failure;
let cleanup;
try {
  const reset = await runIosFixtureCommand('core', owner, 'reset');
  writeFileSync(join(directory, 'initial-reset.json'), JSON.stringify(reset, null, 2) + '\n');
  receipts = await executeAutomaticRecapPersistencePhases(async (identifier, baseline) => {
    const name = String(++index).padStart(2, '0');
    const bundle = join(directory, name + '.xcresult');
    let executionError;
    try {
      execFileSync(
        'scripts/ci/run-command.sh',
        [
          'automatic-recap-' + name,
          join(directory, name + '.log'),
          '--',
          process.execPath,
          'scripts/ci/run-ios-tests.mjs',
          'core',
          runFile,
          ownerFile,
          bundle,
          identifier,
        ],
        {
          stdio: 'inherit',
          env: {
            ...baseEnvironment,
            ...(baseline
              ? { TEST_RUNNER_OROT_AUTOMATIC_RECAP_BASELINE: JSON.stringify(baseline) }
              : {}),
          },
        },
      );
      const report = JSON.parse(
        execFileSync(
          'xcrun',
          ['xcresulttool', 'get', 'test-results', 'tests', '--path', bundle, '--compact'],
          { encoding: 'utf8' },
        ),
      );
      observations.push(...verifyIosTestResults(report, [identifier]));
    } catch (error) {
      executionError = error;
    }
    const attachments = join(directory, name + '-attachments');
    if (existsSync(bundle)) {
      try {
        execFileSync('xcrun', [
          'xcresulttool',
          'export',
          'attachments',
          '--path',
          bundle,
          '--output-path',
          attachments,
        ]);
      } catch (error) {
        if (!executionError) executionError = error;
      }
    }
    // A failed first execution remains authoritative even if an attachment was exported.
    if (executionError) throw executionError;
    const receipt = readSpeechJourneyAttachment(
      attachments,
      identifier,
      owner.udid,
      baseline ? 'automatic-recap-reopened' : 'automatic-recap-seed',
    );
    writeFileSync(join(directory, name + '-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    return receipt;
  });
} catch (error) {
  failure = error;
}
try {
  cleanup = await runIosFixtureCommand('core', owner, 'reset');
} catch (error) {
  if (!failure) failure = error;
  else console.error('Automatic Recap fixture cleanup also failed: ' + String(error));
}
writeFileSync(
  join(directory, 'results.json'),
  JSON.stringify(
    {
      profile: 'core',
      observations,
      receipts,
      cleanup,
      passed: !failure,
      failure: failure ? String(failure) : null,
      elapsedMs: Date.now() - started,
    },
    null,
    2,
  ) + '\n',
);
if (failure) throw failure;
console.log(
  `IOS_AUTOMATIC_RECAP_PERSISTENCE_VERIFIED passed=${observations.length} elapsed_ms=${Date.now() - started}`,
);
