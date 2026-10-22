import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync } from 'node:fs';
import {
  focusedIosTestCohorts,
  selectFocusedIosTests,
  verifyFocusedIosPullRequest,
} from './ios-focused-selection.mjs';

const [profile, file, name, number = '', ...extra] = process.argv.slice(2);
if (extra.length || process.env.GITHUB_ACTIONS !== 'true' || !process.env.GITHUB_OUTPUT)
  throw new Error(
    'iOS focus selection requires the hosted workflow output and four bounded inputs',
  );
const selection = selectFocusedIosTests(profile, file, name);
if (!existsSync(file) || !lstatSync(file).isFile())
  throw new Error('Selected integration test source must be a regular repository file');
const repository = process.env.GITHUB_REPOSITORY;
const sha = process.env.GITHUB_SHA;
const ref = process.env.GITHUB_REF_NAME;
if (
  !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') ||
  !/^[a-f0-9]{40}$/.test(sha ?? '') ||
  !ref
)
  throw new Error('iOS focus requires the actual repository, source SHA and branch');
const checkout = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (checkout !== sha) throw new Error('iOS focus checkout differs from its workflow source SHA');
if (number) {
  if (!/^[1-9]\d*$/.test(number) || !Number.isSafeInteger(Number(number)))
    throw new Error('iOS focus PR number must be a positive integer');
  // Read-only API arguments are constructed from validated repository/number fields, without a shell.
  const pullRequest = JSON.parse(
    execFileSync('gh', ['api', '--method', 'GET', `repos/${repository}/pulls/${number}`], {
      encoding: 'utf8',
    }),
  );
  verifyFocusedIosPullRequest({ repository, sha, ref }, number, pullRequest);
}
appendFileSync(
  process.env.GITHUB_OUTPUT,
  Object.entries({ ...selection, cohorts: JSON.stringify(focusedIosTestCohorts(selection)) })
    .filter(([key]) => key !== 'identifiers')
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n',
);
console.log(
  'IOS_FOCUS_SELECTION ' + JSON.stringify({ ...selection, sourceSha: sha, fullValidation: false }),
);
