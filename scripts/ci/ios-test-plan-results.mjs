import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { iosTestExecutionPlan } from './ios-test-execution-plan.mjs';
import { verifyIosTestCohortResults } from './ios-test-cohort-results.mjs';

const [directory, ...extra] = process.argv.slice(2);
if (
  !directory ||
  extra.length ||
  !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '') ||
  !/^[1-9]\d*$/.test(process.env.GITHUB_RUN_ID ?? '') ||
  !/^[1-9]\d*$/.test(process.env.GITHUB_RUN_ATTEMPT ?? '')
)
  throw new Error('Full integration aggregation requires its actual workflow context');
const plan = iosTestExecutionPlan();
const artifact = (cohort) =>
  `ios-cohort-report-${cohort}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
const names = plan.map((entry) => artifact(entry.cohort)).sort();
if (JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify(names))
  throw new Error('Full integration reports omit a planned job or include an unexpected job');
const context = {
  sourceSha: process.env.GITHUB_SHA,
  runId: process.env.GITHUB_RUN_ID,
  attempt: process.env.GITHUB_RUN_ATTEMPT,
};
const observations = plan.flatMap((entry) => {
  const report = JSON.parse(
    readFileSync(join(directory, artifact(entry.cohort), 'results.json'), 'utf8'),
  );
  return verifyIosTestCohortResults(report, entry.cohort, context);
});
// Speech's native assets, recognition and new-process persistence remain an authentic execution boundary.
execFileSync(
  process.execPath,
  [
    'scripts/ci/speech-test-evidence.mjs',
    join(directory, artifact('speech'), 'speech-integration/attachments'),
    join(directory, 'speech-accuracy.json'),
  ],
  { stdio: 'inherit' },
);
writeFileSync(
  join(directory, 'complete.json'),
  JSON.stringify({ ...context, observations }, null, 2) + '\n',
);
console.log(`IOS_FULL_RESULTS_VERIFIED jobs=${plan.length} observations=${observations.length}`);
