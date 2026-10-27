import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { iosTestConfig } from './ios-test-config.mjs';
import { verifyTestRunContract } from './ios-test-run-contract.mjs';
import { verifyIosTestResults } from './ios-test-results.mjs';
import { readSpeechJourneyAttachment as readAttachment } from './speech-journey-test-phases.mjs';
import { executeEncounterReviewPersistencePhases } from './encounter-review-persistence-test-phases.mjs';
import { resetIosTestFixtureContainer } from './ios-test-fixture-container.mjs';
import { runIosFixtureCommand } from './ios-test-scoped-reset.mjs';

const [runFile, ownerFile, output] = process.argv.slice(2);
if (!output || !existsSync(runFile) || !existsSync(ownerFile) || existsSync(output))
  throw new Error(
    'Encounter review requires verified products, ownership and a new evidence directory',
  );
const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
const config = iosTestConfig('core');
verifyTestRunContract(
  JSON.parse(
    execFileSync('plutil', ['-convert', 'json', '-o', '-', runFile], { encoding: 'utf8' }),
  ),
  config,
);
const application = join(
  dirname(resolve(runFile)),
  config.configuration + '-iphonesimulator',
  config.appName,
);
const runId = randomUUID();
const fixtureIdentifier = 'test-persistence-' + randomUUID();
const directory = resolve(output);
mkdirSync(directory, { recursive: true });
const observations = [];
const started = Date.now();
let phaseIndex = 0;
let failure;
let receipts;
let cleanup;
try {
  receipts = await executeEncounterReviewPersistencePhases({
    runId,
    fixtureIdentifier,
    reset() {
      // This is an independent owned cohort, so existing graph-only test records cannot alter its conflicts.
      resetIosTestFixtureContainer('core', owner, application, { statePersistence: true });
    },
    async run(identifier, phase, previousPids) {
      const name = String(++phaseIndex).padStart(2, '0');
      const bundle = join(directory, name + '.xcresult');
      let executionError;
      try {
        execFileSync(
          'scripts/ci/run-command.sh',
          [
            'encounter-review-' + name,
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
              ...process.env,
              OROT_IOS_ENCOUNTER_REVIEW_PHASE: phase,
              TEST_RUNNER_OROT_ENCOUNTER_REVIEW_RUN_ID: runId,
              TEST_RUNNER_OROT_ENCOUNTER_REVIEW_FIXTURE: fixtureIdentifier,
              TEST_RUNNER_OROT_ENCOUNTER_REVIEW_PREVIOUS_PIDS: JSON.stringify(previousPids),
            },
          },
        );
        const tests = JSON.parse(
          execFileSync(
            'xcrun',
            ['xcresulttool', 'get', 'test-results', 'tests', '--path', bundle, '--compact'],
            { encoding: 'utf8' },
          ),
        );
        observations.push(...verifyIosTestResults(tests, [identifier]));
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
      if (executionError) throw executionError;
      const receipt = readAttachment(
        attachments,
        identifier,
        owner.udid,
        'encounter-review-' + phase,
      );
      writeFileSync(
        join(directory, name + '-receipt.json'),
        JSON.stringify(receipt, null, 2) + '\n',
      );
      return receipt;
    },
  });
} catch (error) {
  failure = error;
}
try {
  // Preserve the first failed phase even if cleanup fails. Only this verified owned application container is reset.
  cleanup = await runIosFixtureCommand('core', owner, 'reset');
} catch (error) {
  if (!failure) failure = error;
  else console.error('Encounter review fixture cleanup also failed: ' + String(error));
}
writeFileSync(
  join(directory, 'results.json'),
  JSON.stringify(
    {
      profile: 'core',
      runId,
      fixtureIdentifier,
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
  `IOS_ENCOUNTER_REVIEW_PERSISTENCE_VERIFIED passed=${observations.length} elapsed_ms=${Date.now() - started}`,
);
