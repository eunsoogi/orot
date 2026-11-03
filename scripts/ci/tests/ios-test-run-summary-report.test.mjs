import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { buildIosTestRunSummary } from '../ios-test-run-summary.mjs';
import { renderIosTestRunSummaryMarkdown } from '../ios-test-run-summary-markdown.mjs';

const context = {
  sourceSha: 'd'.repeat(40),
  runId: '991',
  attempt: '1',
  repository: 'eunsoogi/orot',
  serverUrl: 'https://github.com',
  runUrl: 'https://github.com/eunsoogi/orot/actions/runs/991/attempts/1',
};

test('renders created-to-start delay and longest setup phases without overstating coverage', () => {
  const summary = buildIosTestRunSummary({
    selectedCohorts: ['core-integration'],
    validationTier: 'candidate',
    oauthRequired: true,
    context,
    timing: {
      jobStartDelayMs: 45000,
      jobStartDelayNote:
        'Job created-to-start time may include queue and dependency wait; the API does not expose when a job became runnable.',
      setupPhases: [
        { name: 'Owned Simulator preparation', durationMs: 10000 },
        { name: 'Product build', durationMs: 20000 },
      ],
    },
  });
  const markdown = renderIosTestRunSummaryMarkdown(summary);

  assert.match(
    markdown,
    /Created-to-start delay \(queue and dependency may both contribute\) \| 45\.0 s/,
  );
  assert.match(markdown, /Job created-to-start time may include queue and dependency wait/);
  assert.match(
    markdown,
    /### Longest setup phases[\s\S]*Product build - 20\.0 s[\s\S]*Owned Simulator preparation - 10\.0 s/,
  );
  assert.match(
    markdown,
    /\| OAuth \| not selected \| execution: not-selected; product job: not-selected \|/,
  );
  assert.match(markdown, /\| Production \| not selected \| not-selected \|/);
});

test('unknown observation results remain unknown instead of appearing unexecuted', () => {
  const task = iosTestCohortTasks('core-integration')[0];
  const summary = buildIosTestRunSummary({
    selectedCohorts: ['core-integration'],
    validationTier: 'pr',
    context,
    reports: [
      {
        report: {
          ...context,
          cohort: 'core-integration',
          tasks: [
            {
              profile: task.profile,
              suite: task.suite,
              status: 'failed',
              observations: [{ identifier: task.identifiers[0], result: 'A future result state' }],
            },
          ],
        },
      },
    ],
  });

  assert.equal(
    summary.cases.find((item) => item.identifier === task.identifiers[0]).status,
    'unknown',
  );
  const selectedInventoryCount = iosTestCohortTasks('core-integration').reduce(
    (count, item) => count + item.identifiers.length,
    0,
  );
  assert.equal(summary.coverage.ordinaryIphone.selectedCount, selectedInventoryCount);
  assert.equal(summary.selectedCaseCount, selectedInventoryCount);
});
