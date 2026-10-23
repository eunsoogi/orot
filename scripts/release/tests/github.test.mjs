import assert from 'node:assert/strict';
import test from 'node:test';
import { isAcceptedCiWorkflowEvent } from '../ci-required-jobs.mjs';
import {
  collectJobsForMainValidation,
  latestMainValidationRuns,
  listWorkflowRunsForSourceValidation,
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
    status: 'completed',
    conclusion: 'success',
    created_at: `2026-10-11T00:00:${String(id).padStart(2, '0')}Z`,
    ...overrides,
  };
}

test('selects the newest permitted main run and keeps the latest scheduled E2E attempt', () => {
  const runs = [
    run(1, '.github/workflows/code-quality.yml'),
    run(2, '.github/workflows/code-quality.yml', {
      event: 'workflow_dispatch',
      conclusion: 'failure',
    }),
    run(3, '.github/workflows/e2e-test.yml', { event: 'schedule' }),
    run(4, '.github/workflows/unit-test.yml', { event: 'pull_request' }),
    run(5, '.github/workflows/policy-check.yml', { head_sha: 'b'.repeat(40) }),
    run(6, '.github/workflows/other.yml', { head_branch: 'release' }),
    run(7, '.github/workflows/other.yml', { event: 'workflow_dispatch' }),
    run(8, '.github/workflows/unit-test.yml', {
      event: 'workflow_dispatch',
      head_branch: 'feature',
    }),
    run(9, '.github/workflows/e2e-test.yml', { event: 'workflow_dispatch' }),
    run(11, '.github/workflows/e2e-test.yml', {
      event: 'schedule',
      status: 'queued',
      conclusion: null,
      created_at: '2026-10-11T00:00:11Z',
    }),
    run(10, '.github/workflows/e2e-selected.yml', { event: 'workflow_dispatch' }),
  ];
  assert.deepEqual(
    latestMainValidationRuns(sourceSha, runs).map(({ id }) => id),
    [2, 11],
  );
});

test('release evidence accepts scheduled E2E on main and excludes pushes, dispatches and diagnostics', () => {
  assert.equal(isAcceptedCiWorkflowEvent('.github/workflows/e2e-test.yml', 'schedule'), true);
  assert.equal(
    isAcceptedCiWorkflowEvent('.github/workflows/e2e-test.yml', 'workflow_dispatch'),
    false,
  );
  assert.equal(isAcceptedCiWorkflowEvent('.github/workflows/e2e-test.yml', 'push'), false);
  assert.equal(isAcceptedCiWorkflowEvent('.github/workflows/e2e-test.yml', 'pull_request'), false);
  assert.equal(
    isAcceptedCiWorkflowEvent('.github/workflows/e2e-selected.yml', 'workflow_dispatch'),
    false,
  );
  assert.equal(isAcceptedCiWorkflowEvent('.github/workflows/code-quality.yml', 'push'), true);
});

test('collects jobs only from each selected main validation run', () => {
  const runs = [
    run(1, '.github/workflows/code-quality.yml'),
    run(2, '.github/workflows/code-quality.yml', { run_number: 2 }),
    run(3, '.github/workflows/e2e-test.yml', { event: 'schedule' }),
  ];
  const jobs = collectJobsForMainValidation(sourceSha, runs, (id) => [{ name: `run-${id}` }]);
  assert.deepEqual(jobs, [
    {
      name: 'run-2',
      workflow_path: '.github/workflows/code-quality.yml',
      workflow_run_id: 2,
    },
    {
      name: 'run-3',
      workflow_path: '.github/workflows/e2e-test.yml',
      workflow_run_id: 3,
    },
  ]);
});

test('paginates source workflow runs until the reported total is complete', () => {
  const calls = [];
  const items = listWorkflowRunsForSourceValidation('eunsoogi/orot', sourceSha, (endpoint) => {
    calls.push(endpoint);
    return endpoint.endsWith('page=1')
      ? {
          total_count: 101,
          workflow_runs: Array.from({ length: 100 }, (_, index) => ({ id: index })),
        }
      : { total_count: 101, workflow_runs: [{ id: 100 }] };
  });
  assert.equal(items.length, 101);
  assert.match(calls[0], new RegExp(`head_sha=${sourceSha}`));
  assert.match(calls[0], /branch=main/);
  assert.doesNotMatch(calls[0], /event=/);
  assert.match(calls[0], /page=1$/);
  assert.match(calls[1], /page=2$/);
});

test('fails closed when GitHub reports more source runs than it returns', () => {
  assert.throws(
    () =>
      listWorkflowRunsForSourceValidation('eunsoogi/orot', sourceSha, () => ({
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
