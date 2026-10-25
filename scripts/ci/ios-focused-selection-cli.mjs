import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync } from 'node:fs';
import { focusedIosTestCohorts, selectFocusedIosTests } from './ios-focused-selection.mjs';

const [profile, file, name, ...extra] = process.argv.slice(2);
if (extra.length || process.env.GITHUB_ACTIONS !== 'true' || !process.env.GITHUB_OUTPUT)
  throw new Error(
    'iOS focus selection requires the hosted workflow output and exact selection inputs',
  );
const selection = selectFocusedIosTests(profile, file, name);
if (!existsSync(file) || !lstatSync(file).isFile())
  throw new Error('Selected integration test source must be a regular repository file');
const sha = process.env.GITHUB_SHA;
if (!/^[a-f0-9]{40}$/.test(sha ?? ''))
  throw new Error('iOS focus requires the actual workflow source SHA');
const checkout = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (checkout !== sha) throw new Error('iOS focus checkout differs from its workflow source SHA');
// The caller's checkout SHA is the only source identity; no PR-head API lookup remains.
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
