import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { iosTestConfig } from './ios-test-config.mjs';
import { verifyTestRunContract } from './ios-test-run-contract.mjs';
import { verifyIosTestResults } from './ios-test-results.mjs';
import { readSpeechJourneyAttachment as readAttachment } from './speech-journey-test-phases.mjs';
import { executeStatePersistencePhases } from './state-persistence-test-phases.mjs';
import { resetIosTestFixtureContainer } from './ios-test-fixture-container.mjs';
import { runIosFixtureCommand } from './ios-test-scoped-reset.mjs';

const [runFile, ownerFile, output] = process.argv.slice(2);
if (!output || !existsSync(runFile) || existsSync(output))
  throw new Error(
    'State persistence requires verified products, ownership and a new evidence directory',
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
const fixtureIdentifier = 'test-persistence-' + randomUUID();
const memoryIdentifier = 'test-memory-' + randomUUID();
const directory = resolve(output);
mkdirSync(directory, { recursive: true });
const observations = [];
const started = Date.now();
let phase = 0;
let failure;
let receipts;
let cleanup;
try {
  receipts = await executeStatePersistencePhases({
    fixtureIdentifier,
    memoryIdentifier,
    reset() {
      // This requirement is specifically fresh installation and key creation; scoped reset cannot replace it.
      resetIosTestFixtureContainer('core', owner, application, { statePersistence: true });
    },
    async run(identifier, statePhase, previousPids) {
      const name = String(++phase).padStart(2, '0');
      const bundle = join(directory, name + '.xcresult');
      let executionError;
      try {
        execFileSync(
          'scripts/ci/run-command.sh',
          [
            'state-persistence-' + name,
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
              OROT_IOS_STATE_PHASE: statePhase,
              TEST_RUNNER_OROT_STATE_FIXTURE: fixtureIdentifier,
              TEST_RUNNER_OROT_STATE_MEMORY_FIXTURE: memoryIdentifier,
              TEST_RUNNER_OROT_STATE_PREVIOUS_PIDS: JSON.stringify(previousPids),
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
      const result = readAttachment(
        attachments,
        identifier,
        owner.udid,
        'state-persistence-' + statePhase,
      );
      writeFileSync(
        join(directory, name + '-receipt.json'),
        JSON.stringify(result, null, 2) + '\n',
      );
      return result;
    },
  });
} catch (error) {
  failure = error;
}
try {
  // Cleanup is scoped to this owned container even after the first failed phase; it never permits another test to continue.
  cleanup = await runIosFixtureCommand('core', owner, 'reset');
} catch (error) {
  if (!failure) failure = error;
  else console.error('State persistence cleanup also failed: ' + String(error));
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
  `IOS_STATE_PERSISTENCE_VERIFIED passed=${observations.length} elapsed_ms=${Date.now() - started}`,
);
