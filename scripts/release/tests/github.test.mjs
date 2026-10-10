import assert from 'node:assert/strict';
import test from 'node:test';
import { collectJobsForMainPushes } from '../github.mjs';

const sourceSha = 'a'.repeat(40);

test('collects required leaves from separate main-push workflows for the exact source commit', () => {
  const workflowRuns = [
    {
      id: 102,
      path: '.github/workflows/quality-linux.yml',
      event: 'push',
      head_branch: 'main',
      head_sha: sourceSha,
    },
    {
      id: 103,
      path: '.github/workflows/unit-test.yml',
      event: 'push',
      head_branch: 'main',
      head_sha: sourceSha,
    },
    // The policy job now publishes from its own main-push workflow run.
    {
      id: 107,
      path: '.github/workflows/policy-check.yml',
      event: 'push',
      head_branch: 'main',
      head_sha: sourceSha,
    },
    {
      id: 104,
      path: '.github/workflows/quality-linux.yml',
      event: 'pull_request',
      head_branch: 'main',
      head_sha: sourceSha,
    },
    {
      id: 105,
      path: '.github/workflows/quality-linux.yml',
      event: 'push',
      head_branch: 'main',
      head_sha: 'b'.repeat(40),
    },
    {
      id: 106,
      path: '.github/workflows/quality-linux.yml',
      event: 'push',
      head_branch: 'release',
      head_sha: sourceSha,
    },
  ];
  const primaryE2eRun = {
    id: 101,
    path: '.github/workflows/e2e-test.yml',
    event: 'push',
    head_branch: 'main',
    head_sha: sourceSha,
  };
  const jobsByRun = new Map([
    [101, [{ name: 'iOS Simulator Build', status: 'completed', conclusion: 'success' }]],
    [102, [{ name: 'Maintained file inventory', status: 'completed', conclusion: 'success' }]],
    [103, [{ name: 'TypeScript typecheck', status: 'completed', conclusion: 'success' }]],
    [
      107,
      [{ name: 'CI, release, and quality gate tests', status: 'completed', conclusion: 'success' }],
    ],
  ]);
  const readRunIds = [];

  const jobs = collectJobsForMainPushes(sourceSha, workflowRuns, primaryE2eRun, (runId) => {
    readRunIds.push(runId);
    return jobsByRun.get(runId);
  });

  assert.deepEqual(readRunIds, [102, 103, 107, 101]);
  assert.deepEqual(
    jobs.map(({ name }) => name),
    [
      'Maintained file inventory',
      'TypeScript typecheck',
      'CI, release, and quality gate tests',
      'iOS Simulator Build',
    ],
  );
});

test('does not duplicate the primary E2E Test workflow run when it appears in the source run list', () => {
  const primaryE2eRun = {
    id: 101,
    path: '.github/workflows/e2e-test.yml',
    event: 'push',
    head_branch: 'main',
    head_sha: sourceSha,
  };
  const readRunIds = [];

  collectJobsForMainPushes(sourceSha, [primaryE2eRun], primaryE2eRun, (runId) => {
    readRunIds.push(runId);
    return [];
  });

  assert.deepEqual(readRunIds, [101]);
});
