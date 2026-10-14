import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { selectFocusedIosTests } from './ios-focused-selection.mjs';
import { verifyIosObservationList } from './ios-test-results.mjs';

// Selection and JSON completeness checks require no Apple tools and run on Linux after the Mac exporter.
const [profile, file, name, directory] = process.argv.slice(2);
if (
  !directory ||
  !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '') ||
  !/^[1-9]\d*$/.test(process.env.GITHUB_RUN_ID ?? '') ||
  !/^[1-9]\d*$/.test(process.env.GITHUB_RUN_ATTEMPT ?? '')
)
  throw new Error('Focused result verification requires selection and downloaded evidence');
const selection = selectFocusedIosTests(profile, file, name);
const manifest = JSON.parse(
  readFileSync(join(directory, 'product-artifact/manifest.json'), 'utf8'),
);
const context = manifest.context;
if (
  context.sourceSha !== process.env.GITHUB_SHA ||
  String(context.runId) !== process.env.GITHUB_RUN_ID ||
  String(context.attempt) !== process.env.GITHUB_RUN_ATTEMPT ||
  context.spec.configuration !== selection.configuration ||
  !context.spec.compatibleExecutions.includes(selection.profile)
)
  throw new Error('Focused results belong to a stale or incompatible integration product');
const reportFile =
  selection.mode === 'fixture'
    ? 'fixtures/results.json'
    : ['backup', 'local-model'].includes(selection.mode)
      ? `${selection.mode}/results.json`
      : 'results.json';
const report = JSON.parse(readFileSync(join(directory, reportFile), 'utf8'));
const observations = verifyIosObservationList(report.observations, selection.identifiers);
console.log(
  JSON.stringify({
    sourceSha: context.sourceSha,
    selectedCases: observations.length,
    fullValidation: false,
  }),
);
