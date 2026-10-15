import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { iosTestConfig } from './ios-test-config.mjs';
import { verifyTestRunContract } from './ios-test-run-contract.mjs';
import { verifyIosTestResults } from './ios-test-results.mjs';
import { readSpeechJourneyAttachment as readAttachment } from './speech-journey-test-phases.mjs';
import { executeFixtureIsolationPhases } from './fixture-isolation-test-phases.mjs';
import {
  ensureIosFixtureInstalled,
  ownedFixtureCommand,
  runIosFixtureCommand,
} from './ios-test-scoped-reset.mjs';

const [runFile, ownerFile, output] = process.argv.slice(2);
if (!output || !existsSync(runFile) || existsSync(output))
  throw new Error(
    'Fixture isolation requires verified products, ownership and a new evidence directory',
  );
const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
const config = iosTestConfig('core');
verifyTestRunContract(
  JSON.parse(
    execFileSync('plutil', ['-convert', 'json', '-o', '-', runFile], { encoding: 'utf8' }),
  ),
  config,
);
const app = join(
  dirname(resolve(runFile)),
  config.configuration + '-iphonesimulator',
  config.appName,
);
ensureIosFixtureInstalled('core', owner, app);
const directory = resolve(output);
mkdirSync(directory, { recursive: true });
const token = randomUUID();
const observations = [];
const started = Date.now();
let phase = 0;
const receipts = await executeFixtureIsolationPhases({
  async reset() {
    const receipt = await runIosFixtureCommand(
      'core',
      owner,
      'reset',
      phase ? token : randomUUID(),
    );
    // Keep both cold-process observations even if the later XCTest host fails.
    writeFileSync(
      join(directory, phase ? 'reset-after-pollution.json' : 'initial-reset.json'),
      JSON.stringify(receipt, null, 2) + '\n',
    );
    return receipt;
  },
  async pollute() {
    // Native permission tests still exercise prompts; this explicit grant only creates a reset-regression contaminant.
    ownedFixtureCommand('core', owner, [
      'privacy',
      owner.udid,
      'grant',
      'microphone',
      'com.orot.mobile',
    ]);
    const receipt = await runIosFixtureCommand('core', owner, 'seed', token);
    writeFileSync(join(directory, 'pollution.json'), JSON.stringify(receipt, null, 2) + '\n');
    return receipt;
  },
  async run(identifier, baseline) {
    const name = String(++phase).padStart(2, '0');
    const bundle = join(directory, name + '.xcresult');
    let failure;
    try {
      execFileSync(
        'scripts/ci/run-command.sh',
        [
          'fixture-isolation-' + name,
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
            OROT_IOS_FIXTURE_PHASE: baseline ? 'verify' : 'seed',
            TEST_RUNNER_OROT_FIXTURE_TOKEN: token,
            ...(baseline ? { TEST_RUNNER_OROT_FIXTURE_BASELINE: JSON.stringify(baseline) } : {}),
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
      failure = error;
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
        if (!failure) failure = error;
      }
    }
    if (failure) throw failure;
    return readAttachment(
      attachments,
      identifier,
      owner.udid,
      baseline ? 'fixture-isolation-verified' : 'fixture-isolation-seeded',
    );
  },
});
// The proof's newly initialized empty database is also removed before ordinary Core tests begin.
const cleanup = await runIosFixtureCommand('core', owner, 'reset');
writeFileSync(
  join(directory, 'results.json'),
  JSON.stringify(
    { profile: 'core', observations, receipts, cleanup, elapsedMs: Date.now() - started },
    null,
    2,
  ) + '\n',
);
console.log(
  `IOS_FIXTURE_ISOLATION_VERIFIED passed=${observations.length} elapsed_ms=${Date.now() - started}`,
);
