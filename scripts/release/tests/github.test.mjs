import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectJobsForMainPushes,
  latestMainPushRuns,
  listWorkflowRunsForSourcePushes,
  readWorkflowRunJobs,
} from '../ci.mjs';
import { sourceSha } from './fixtures.mjs';

function run(id, path, overrides = {}) {
  return {
    id,
    path,
    event: 'push',
    head_branch: 'main',
    head_sha: sourceSha,
    created_at: `2026-10-11T00:00:${String(id).padStart(2, '0')}Z`,
    ...overrides,
  };
}

test('selects the latest run per workflow for the exact main-push candidate', () => {
  const runs = [
    run(1, '.github/workflows/code-quality.yml'),
    run(2, '.github/workflows/code-quality.yml', { conclusion: 'failure' }),
    run(3, '.github/workflows/e2e-test.yml'),
    run(4, '.github/workflows/unit-test.yml', { event: 'pull_request' }),
    run(5, '.github/workflows/policy-check.yml', { head_sha: 'b'.repeat(40) }),
    run(6, '.github/workflows/other.yml', { head_branch: 'release' }),
  ];
  assert.deepEqual(
    latestMainPushRuns(sourceSha, runs).map(({ id }) => id),
    [2, 3],
  );
});

test('collects jobs only from the selected run for each main-push workflow', () => {
  const runs = [
    run(1, '.github/workflows/code-quality.yml'),
    run(2, '.github/workflows/code-quality.yml', { run_number: 2 }),
    run(3, '.github/workflows/e2e-test.yml'),
  ];
  const jobs = collectJobsForMainPushes(sourceSha, runs, (id) => [{ name: `run-${id}` }]);
  assert.deepEqual(
    jobs.map(({ name }) => name),
    ['run-2', 'run-3'],
  );
});

test('paginates source workflow runs until the reported total is complete', () => {
  const calls = [];
  const items = listWorkflowRunsForSourcePushes('eunsoogi/orot', sourceSha, (endpoint) => {
    calls.push(endpoint);
    return endpoint.endsWith('page=1')
      ? {
          total_count: 101,
          workflow_runs: Array.from({ length: 100 }, (_, index) => ({ id: index })),
        }
      : { total_count: 101, workflow_runs: [{ id: 100 }] };
  });
  assert.equal(items.length, 101);
  assert.match(calls[0], /page=1$/);
  assert.match(calls[1], /page=2$/);
});

test('fails closed when GitHub reports more source runs than it returns', () => {
  assert.throws(
    () =>
      listWorkflowRunsForSourcePushes('eunsoogi/orot', sourceSha, () => ({
        total_count: 101,
        workflow_runs: [],
      })),
    /incomplete workflow run list/,
  );
});

test('paginates workflow jobs when a run has more than one page', () => {
  const calls = [];
  const jobs = readWorkflowRunJobs('eunsoogi/orot', 123, (endpoint) => {
    calls.push(endpoint);
    return endpoint.endsWith('page=1')
      ? { jobs: Array.from({ length: 100 }, (_, index) => ({ id: index })) }
      : { jobs: [{ id: 100 }] };
  });
  assert.equal(jobs.length, 101);
  assert.match(calls[1], /page=2$/);
});
