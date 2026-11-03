import assert from 'node:assert/strict';
import test from 'node:test';
import {
  iosWorkflowExecutionResults,
  readIosWorkflowTiming,
} from '../ios-test-run-actions-api.mjs';

const sourceSha = 'b'.repeat(40);

test('Actions timing readback rejects jobs from another run attempt', async () => {
  const run = { id: 500, run_attempt: 2, head_sha: sourceSha };
  const result = await readIosWorkflowTiming({
    repository: 'eunsoogi/orot',
    runId: '500',
    attempt: '2',
    sourceSha,
    token: 'read-only-test-token',
    fetchImpl: async (url) => ({
      ok: true,
      json: async () =>
        url.includes('/jobs?') ? { jobs: [{ run_id: 500, run_attempt: 1 }] } : run,
    }),
  });

  assert.equal(result.available, false);
  assert.match(result.reason, /different run or attempt/);
});

test('reads jobs from the requested attempt without requiring a job-level attempt field', async () => {
  const urls = [];
  const result = await readIosWorkflowTiming({
    repository: 'eunsoogi/orot',
    runId: '500',
    attempt: '2',
    sourceSha,
    token: 'read-only-test-token',
    fetchImpl: async (url) => {
      urls.push(url);
      return {
        ok: true,
        json: async () =>
          url.includes('/jobs?')
            ? { jobs: [{ run_id: 500, name: 'Build', labels: ['macos-26'] }] }
            : { id: 500, run_attempt: 2, head_sha: sourceSha },
      };
    },
  });

  assert.equal(result.available, true);
  assert.ok(urls.some((url) => url.includes('/actions/runs/500/attempts/2/jobs?')));
  assert.ok(urls.every((url) => !url.includes('filter=latest')));
});

test('reads run metadata from the requested attempt after a later rerun exists', async () => {
  const urls = [];
  const result = await readIosWorkflowTiming({
    repository: 'eunsoogi/orot',
    runId: '500',
    attempt: '1',
    sourceSha,
    token: 'read-only-test-token',
    fetchImpl: async (url) => {
      urls.push(url);
      const run = url.endsWith('/attempts/1')
        ? { id: 500, run_attempt: 1, head_sha: sourceSha }
        : { id: 500, run_attempt: 2, head_sha: sourceSha };
      return {
        ok: true,
        json: async () => (url.includes('/jobs?') ? { jobs: [] } : run),
      };
    },
  });

  assert.equal(result.available, true);
  assert.ok(
    urls.includes('https://api.github.com/repos/eunsoogi/orot/actions/runs/500/attempts/1'),
  );
  assert.ok(urls.some((url) => url.includes('/actions/runs/500/attempts/1/jobs?')));
});

test('reconstructs per-cohort and auxiliary job outcomes from exact workflow names', () => {
  const results = iosWorkflowExecutionResults(
    [
      { name: 'Test / Core', conclusion: 'failure' },
      { name: 'Test / Speech', conclusion: 'cancelled' },
      { name: 'Test / Keychain authentication', conclusion: 'skipped' },
      { name: 'Build / OAuth', conclusion: 'success' },
      { name: 'Test / OAuth', conclusion: 'failure' },
      { name: 'Build / Production', conclusion: 'success' },
    ],
    ['core-integration', 'speech'],
  );

  assert.deepEqual(results.cohorts, {
    'core-integration': { result: 'failure' },
    speech: { result: 'cancelled' },
  });
  assert.deepEqual(results.authentication, { result: 'skipped' });
  assert.deepEqual(results.oauth_products, { result: 'success' });
  assert.deepEqual(results.oauth_execution, { result: 'failure' });
  assert.deepEqual(results.production_validation, { result: 'success' });
});
