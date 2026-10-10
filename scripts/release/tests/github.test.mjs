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
      path: '.github/workflows/quality-linux-tests.yml',
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
  const primaryCiRun = {
    id: 101,
    path: '.github/workflows/ci.yml',
    event: 'push',
    head_branch: 'main',
    head_sha: sourceSha,
  };
  const jobsByRun = new Map([
    [101, [{ name: 'iOS Simulator Build', status: 'completed', conclusion: 'success' }]],
    [102, [{ name: 'Maintained file inventory', status: 'completed', conclusion: 'success' }]],
    [103, [{ name: 'TypeScript typecheck', status: 'completed', conclusion: 'success' }]],
  ]);
  const readRunIds = [];

  const jobs = collectJobsForMainPushes(sourceSha, workflowRuns, primaryCiRun, (runId) => {
    readRunIds.push(runId);
    return jobsByRun.get(runId);
  });

  assert.deepEqual(readRunIds, [102, 103, 101]);
  assert.deepEqual(
    jobs.map(({ name }) => name),
    ['Maintained file inventory', 'TypeScript typecheck', 'iOS Simulator Build'],
  );
});

test('does not duplicate the primary CI workflow run when it appears in the source run list', () => {
  const primaryCiRun = {
    id: 101,
    path: '.github/workflows/ci.yml',
    event: 'push',
    head_branch: 'main',
    head_sha: sourceSha,
  };
  const readRunIds = [];

  collectJobsForMainPushes(sourceSha, [primaryCiRun], primaryCiRun, (runId) => {
    readRunIds.push(runId);
    return [];
  });

  assert.deepEqual(readRunIds, [101]);
});
