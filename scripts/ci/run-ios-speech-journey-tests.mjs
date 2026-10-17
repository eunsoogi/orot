import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { verifyIosTestSimulator } from './ios-test-simulator.mjs';
import { verifyIosTestResults } from './ios-test-results.mjs';
import {
  executeSpeechJourneyPhases,
  readSpeechJourneyAttachment,
} from './speech-journey-test-phases.mjs';

const [runFile, ownerFile, output] = process.argv.slice(2);
if (!output || !existsSync(runFile) || existsSync(output))
  throw new Error(
    'Speech journey requires verified products, ownership and a new evidence directory',
  );
const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
const directory = resolve(output);
mkdirSync(directory, { recursive: true });
const observations = [];
const started = Date.now();
let phase = 0;
const results = await executeSpeechJourneyPhases(async (identifier, baseline) => {
  if (verifyIosTestSimulator(owner, 'speech').state !== 'Booted')
    throw new Error('Speech journey requires its booted owned destination');
  const name = String(++phase).padStart(2, '0');
  const bundle = join(directory, name + '.xcresult');
  let failure;
  try {
    execFileSync(
      'scripts/ci/run-command.sh',
      [
        'speech-journey-' + name,
        join(directory, name + '.log'),
        '--',
        process.execPath,
        'scripts/ci/run-ios-tests.mjs',
        'speech',
        runFile,
        ownerFile,
        bundle,
        identifier,
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          OROT_IOS_SPEECH_PHASE: baseline ? 'readback' : 'ui',
          ...(baseline ? { TEST_RUNNER_OROT_SPEECH_BASELINE: JSON.stringify(baseline) } : {}),
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
  // Preserve original failure artifacts; no subsequent process is scheduled after a failed phase.
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
  return readSpeechJourneyAttachment(
    attachments,
    identifier,
    owner.udid,
    baseline ? 'automatic-persisted-relaunch' : 'automatic-saved-result',
  );
});
writeFileSync(
  join(directory, 'results.json'),
  JSON.stringify(
    {
      profile: 'speech',
      observations,
      results,
      elapsedMs: Date.now() - started,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `IOS_SPEECH_JOURNEY_VERIFIED passed=${observations.length} elapsed_ms=${Date.now() - started}`,
);
