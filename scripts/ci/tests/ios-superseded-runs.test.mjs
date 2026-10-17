import assert from 'node:assert/strict';
import test from 'node:test';
import { workflow } from './fixtures/ios-workflow.mjs';

const manager = workflow('.github/workflows/cancel-stale-ios-focused.yml');
const job = manager.jobs.cancel_superseded_full;
const script = job.steps[0].with.script;
const execute = new (Object.getPrototypeOf(async function () {}).constructor)(
  'github',
  'context',
  'core',
  script,
);
const repo = { id: 1400991370, full_name: 'eunsoogi/orot' };
const head = 'a'.repeat(40);
const previous = 'b'.repeat(40);
const pullRequest = {
  id: 2000,
  number: 200,
  state: 'open',
  draft: true,
  updated_at: '2026-10-15T18:00:00Z',
  head: { sha: head, ref: 'eunsoogi/issue-198', repo },
  base: { repo },
};
const workflowIdentity = { id: 380758490, path: '.github/workflows/e2e-test.yml' };
const candidate = {
  id: 10,
  workflow_id: workflowIdentity.id,
  path: workflowIdentity.path,
  repository: repo,
  head_repository: repo,
  event: 'pull_request',
  head_branch: pullRequest.head.ref,
  head_sha: previous,
  status: 'in_progress',
  conclusion: null,
  run_attempt: 1,
  created_at: '2026-10-15T17:00:00Z',
  pull_requests: [{ id: pullRequest.id, number: pullRequest.number }],
};

/** Execute the actual static workflow code with recorded API responses; no real run is cancelled. */
async function inspect({
  runs = [candidate],
  action = 'synchronize',
  event = pullRequest,
  current = [pullRequest],
  refreshed,
  inventoryCount = runs.length,
  identity = workflowIdentity,
  failCancellation = false,
} = {}) {
  const requested = [];
  let reads = 0;
  const data = (value) => ({ data: structuredClone(value) });
  const github = {
    rest: {
      pulls: {
        get: async (args) => {
          assert.deepEqual(args, { owner: 'eunsoogi', repo: 'orot', pull_number: event.number });
          return data(current[Math.min(reads++, current.length - 1)]);
        },
      },
      actions: {
        getWorkflow: async () => data(identity),
        listWorkflowRuns: async (args) => {
          assert.equal(args.workflow_id, workflowIdentity.id);
          assert.equal(args.event, 'pull_request');
          assert.equal(args.branch, event.head.ref);
          return data({ total_count: inventoryCount, workflow_runs: runs });
        },
        getWorkflowRun: async ({ run_id }) =>
          data(refreshed ?? runs.find((run) => run.id === run_id)),
        cancelWorkflowRun: async (args) => {
          if (failCancellation) throw new Error('API rejected cancellation');
          requested.push(args);
        },
      },
    },
  };
  const context = {
    eventName: 'pull_request',
    repo: { owner: 'eunsoogi', repo: 'orot' },
    runId: 99,
    payload: { repository: repo, number: event.number, pull_request: event, action },
  };
  await execute(github, context, { info: () => {} });
  return requested;
}

test('only the static cancellation job receives write permission and it never checks out PR code', () => {
  assert.deepEqual(manager.on.pull_request.types, ['synchronize', 'reopened']);
  assert.deepEqual(manager.permissions, {});
  assert.deepEqual(job.permissions, { actions: 'write', 'pull-requests': 'read' });
  assert.equal(manager.jobs.cancel_superseded_focus.permissions, undefined);
  assert.equal(job.steps.length, 1);
  assert.match(job.steps[0].uses, /^actions\/github-script@[a-f0-9]{40}$/);
  assert.equal(job.steps[0].with.retries, 0);
  assert.doesNotMatch(
    script,
    /\$\{\{|require\(|import\s|eval\(|new Function|exec\(|spawn\(|\.title|\.body/,
  );
  assert.equal(workflow('.github/workflows/e2e-test.yml').concurrency['cancel-in-progress'], false);
  assert.deepEqual(manager.jobs.cancel_superseded_focus.concurrency, {
    group: 'focused-ios-${{ github.event.pull_request.number }}-scenario',
    'cancel-in-progress': true,
  });
});

test('a verified older head of this workflow and PR is cancelled once', async () => {
  assert.deepEqual(await inspect(), [{ owner: 'eunsoogi', repo: 'orot', run_id: 10 }]);
});

test('draft and ready metadata preserve active full runs without a replacement source event', async () => {
  for (const action of ['ready_for_review', 'converted_to_draft']) {
    for (const head_sha of [head, previous])
      assert.deepEqual(await inspect({ action, runs: [{ ...candidate, head_sha }] }), []);
  }
});

test('other identities, the current head, reruns and completed runs are excluded', async () => {
  const cases = [
    { id: 99 },
    { workflow_id: 3 },
    { path: '.github/workflows/unit-test.yml' },
    { repository: { id: 1 } },
    { head_repository: { id: 1 } },
    { event: 'workflow_dispatch' },
    { head_branch: 'another-pr' },
    { head_sha: head },
    { head_sha: '' },
    { pull_requests: [{ id: 2001, number: 201 }] },
    { pull_requests: [] },
    { pull_requests: [candidate.pull_requests[0], { id: 2001, number: 201 }] },
    { run_attempt: 2 },
    { status: 'completed', conclusion: 'success' },
  ];
  for (const change of cases)
    assert.deepEqual(
      await inspect({ runs: [{ ...candidate, ...change }] }),
      [],
      JSON.stringify(change),
    );
});

test('same-head reopening requires strictly earlier timestamps and a still-current event', async () => {
  const sameHead = { ...candidate, head_sha: head };
  assert.equal((await inspect({ action: 'reopened', runs: [sameHead] })).length, 1);
  for (const created_at of ['2026-10-15T18:00:00Z', '2026-10-15T18:00:01Z', 'invalid'])
    assert.deepEqual(
      await inspect({ action: 'reopened', runs: [{ ...sameHead, created_at }] }),
      [],
    );
  for (const stale of [
    { ...pullRequest, head: { ...pullRequest.head, sha: previous } },
    { ...pullRequest, updated_at: '2026-10-15T18:00:01Z' },
    { ...pullRequest, draft: false },
    { ...pullRequest, state: 'closed' },
  ]) {
    assert.deepEqual(await inspect({ current: [stale] }), []);
    assert.deepEqual(await inspect({ current: [pullRequest, stale] }), []);
  }
});

test('invalid events, changed run identity and ambiguous inventories fail closed', async () => {
  assert.deepEqual(await inspect({ event: { ...pullRequest, updated_at: 'invalid' } }), []);
  assert.deepEqual(
    await inspect({ event: { ...pullRequest, head: { ...pullRequest.head, repo: { id: 1 } } } }),
    [],
  );
  assert.deepEqual(await inspect({ refreshed: { ...candidate, head_sha: head } }), []);
  assert.deepEqual(await inspect({ refreshed: { ...candidate, run_attempt: 2 } }), []);
  await assert.rejects(
    inspect({ identity: { ...workflowIdentity, path: 'other.yml' } }),
    /workflow identity/,
  );
  await assert.rejects(inspect({ inventoryCount: 1001 }), /bounded cancellation/);
  await assert.rejects(inspect({ failCancellation: true }), /API rejected/);
});
