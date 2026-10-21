import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

function run(t, cohorts, oauth) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-cohort-plan-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = join(directory, 'outputs');
  writeFileSync(output, '');
  const result = spawnSync(process.execPath, ['scripts/ci/ios-test-cohort-plan-cli.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_OUTPUT: output,
      OROT_IOS_TEST_COHORTS: JSON.stringify(cohorts),
      OROT_IOS_OAUTH_TESTS: String(oauth),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return {
    plan: JSON.parse(result.stdout),
    outputs: Object.fromEntries(
      readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => {
          const index = line.indexOf('=');
          return [line.slice(0, index), line.slice(index + 1)];
        }),
    ),
  };
}

test('the plan CLI emits only selected profile cohorts and their explicit exclusions', (t) => {
  const { plan, outputs } = run(t, ['backup'], false);

  assert.deepEqual(plan.selectedCohorts, ['backup']);
  assert.deepEqual(plan.notSelectedCohorts, [
    'core-integration',
    'core-ui',
    'persistence',
    'isolation',
    'local-model',
    'navigation-features',
    'navigation-routes',
    'navigation-imports',
    'recordings',
    'questions-review',
    'questions-conversation',
    'questions-summary',
    'calendar-consent',
    'calendar-appointments',
    'provider',
    'health',
    'microphone',
    'selection',
    'speech',
  ]);
  assert.equal(plan.scheduledTestObservations, 5);
  assert.equal(plan.oauthRequired, false);
  assert.deepEqual(JSON.parse(outputs.selected_cohorts), ['backup']);
  assert.deepEqual(JSON.parse(outputs.release_cohorts), ['backup']);
  assert.deepEqual(JSON.parse(outputs.debug_cohorts), []);
  assert.equal(outputs.has_debug, 'false');
  assert.equal(outputs.has_release, 'true');
  assert.equal(outputs.oauth_required, 'false');
});

test('a full plan schedules all 111 observations and OAuth when selected', (t) => {
  const cohorts = [
    'core-integration',
    'core-ui',
    'persistence',
    'isolation',
    'backup',
    'local-model',
    'navigation-features',
    'navigation-routes',
    'navigation-imports',
    'recordings',
    'questions-review',
    'questions-conversation',
    'questions-summary',
    'calendar-consent',
    'calendar-appointments',
    'provider',
    'health',
    'microphone',
    'selection',
    'speech',
  ];
  const { plan, outputs } = run(t, cohorts, true);

  assert.equal(plan.selectedCohorts.length, 20);
  assert.equal(plan.notSelectedCohorts.length, 0);
  assert.equal(plan.uniqueTestCases, 111);
  assert.equal(plan.scheduledTestObservations, 111);
  assert.equal(plan.oauthRequired, true);
  assert.equal(JSON.parse(outputs.not_selected_cohorts).length, 0);
  assert.equal(JSON.parse(outputs.debug_cohorts).length, 4);
  assert.equal(JSON.parse(outputs.release_cohorts).length, 16);
  assert.equal(outputs.has_debug, 'true');
  assert.equal(outputs.has_release, 'true');
  assert.equal(outputs.oauth_required, 'true');
});
