import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { iosTestConfig } from './ios-test-config.mjs';
import { verifyTestRunContract } from './ios-test-run-contract.mjs';
import { verifyIosTestResults } from './ios-test-results.mjs';
import { readSpeechJourneyAttachment as readAttachment } from './speech-journey-test-phases.mjs';
import { executeRecordingPersistencePhases } from './recording-persistence-test-phases.mjs';
import { ensureIosFixtureInstalled, runIosFixtureCommand } from './ios-test-scoped-reset.mjs';

const [runFile, ownerFile, output] = process.argv.slice(2);
if (!output || !existsSync(runFile) || existsSync(output))
  throw new Error(
    'Recording persistence requires verified products, ownership and a new evidence directory',
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
let phase = 0;
let failure;
let receipts;
let cleanup;
try {
  receipts = await executeRecordingPersistencePhases({
    async reset() {
      const receipt = await runIosFixtureCommand('core', owner, 'reset');
      writeFileSync(join(directory, 'initial-reset.json'), JSON.stringify(receipt, null, 2) + '\n');
    },
    async run(identifier, baseline) {
      const name = String(++phase).padStart(2, '0');
      const bundle = join(directory, name + '.xcresult');
      let executionError;
      try {
        execFileSync(
          'scripts/ci/run-command.sh',
          [
            'recording-persistence-' + name,
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
              OROT_IOS_RECORDING_PHASE: baseline ? 'read' : 'seed',
              ...(baseline
                ? { TEST_RUNNER_OROT_RECORDING_BASELINE: JSON.stringify(baseline) }
                : {}),
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
        baseline ? 'recording-persistence-restored' : 'recording-persistence-seeded',
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
  else console.error('Recording cleanup also failed: ' + String(error));
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
  `IOS_RECORDING_PERSISTENCE_VERIFIED passed=${observations.length} elapsed_ms=${Date.now() - started}`,
);
