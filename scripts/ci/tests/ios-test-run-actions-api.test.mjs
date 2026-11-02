import assert from 'node:assert/strict';
import test from 'node:test';
import { readIosWorkflowTiming } from '../ios-test-run-actions-api.mjs';

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
