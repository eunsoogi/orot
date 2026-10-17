import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { discoverReadyValidationCandidate } from '../ios-ready-validation-evidence-policy.mjs';

const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const headRef = 'eunsoogi/issue-203-e2e-selection-ready-policy';
const prNumber = 205;

function currentEvent(overrides = {}) {
  return {
    repository: 'eunsoogi/orot',
    event: 'pull_request',
    action: 'edited',
    currentRunId: '99',
    changes: { body: { from: 'old body' } },
    metadataOnlyEdit: true,
    selectionComplete: true,
    pullRequest: {
      number: prNumber,
      draft: false,
      baseSha,
      baseRef: 'main',
      headSha,
      headRef,
    },
    ...overrides,
  };
}

function sourceRun(id, options = {}) {
  const run = {
    id,
    run_attempt: 1,
    status: options.status ?? 'completed',
    conclusion: options.conclusion ?? 'success',
    event: 'pull_request',
    path: '.github/workflows/e2e-test.yml',
    head_sha: headSha,
    head_branch: headRef,
    created_at: options.createdAt ?? '2026-10-17T20:00:00Z',
    updated_at: options.updatedAt ?? options.createdAt ?? '2026-10-17T20:00:00Z',
    pull_requests: [
      {
        number: prNumber,
        base: { ref: 'main', sha: baseSha },
        head: { ref: headRef, sha: headSha },
      },
    ],
  };
  const jobs = [
    'Plan / Select',
    'Plan / Coverage',
    'Validate / Build',
    'Validate / UI',
    'Validate / Storage',
    'Validate / Provider',
    'Validate / Speech',
    'Validate / Questions',
    'Validate / Complete',
    'Reuse / Ready evidence',
  ].map((name) => ({ name, status: 'completed', conclusion: 'success' }));
  jobs.find(({ name }) => name === 'Reuse / Ready evidence').conclusion = 'skipped';
  for (const [name, change] of Object.entries(options.jobs ?? {})) {
    const job = jobs.find((item) => item.name === name);
    if (job) Object.assign(job, change);
    else jobs.push({ name, ...change });
  }
  const artifacts = [
    { name: `ios-e2e-selection-${id}-1`, expired: false },
    { name: `ios-e2e-results-${id}-1`, expired: false },
  ];
  if (options.missingResults) artifacts.pop();
  return { run, jobs, artifacts };
}

function discover(items, current = currentEvent()) {
  const byId = new Map(items.map((item) => [String(item.run.id), item]));
  return discoverReadyValidationCandidate(
    {
      listRuns: async () => items.map(({ run }) => run),
      listJobs: async (run) => byId.get(String(run.id)).jobs,
      listArtifacts: async (run) => byId.get(String(run.id)).artifacts,
    },
    current,
  );
}

test('a newer failed, cancelled, incomplete, or missing-result Ready run blocks older evidence', async () => {
  const variants = [
    sourceRun(14, { conclusion: 'failure', createdAt: '2026-10-17T20:01:00Z' }),
    sourceRun(14, { conclusion: 'cancelled', createdAt: '2026-10-17T20:01:00Z' }),
    sourceRun(14, {
      status: 'in_progress',
      conclusion: null,
      createdAt: '2026-10-17T20:01:00Z',
    }),
    sourceRun(14, {
      createdAt: '2026-10-17T20:01:00Z',
      jobs: { 'Validate / UI': { conclusion: 'failure' } },
    }),
    sourceRun(14, { createdAt: '2026-10-17T20:01:00Z', missingResults: true }),
  ];
  for (const newer of variants)
    await assert.rejects(discover([sourceRun(13), newer]), /Ready validation/);
});

test('completed metadata and deferred draft runs do not replace a successful Ready source', async () => {
  const valid = sourceRun(13);
  const metadata = sourceRun(14, {
    conclusion: 'failure',
    createdAt: '2026-10-17T20:02:00Z',
    jobs: { 'Reuse / Ready evidence': { conclusion: 'failure' } },
  });
  const draft = sourceRun(15, {
    createdAt: '2026-10-17T20:03:00Z',
    jobs: {
      'Reuse / Ready evidence': { conclusion: 'skipped' },
      'Validate / Build': { conclusion: 'skipped' },
      'Validate / UI': { conclusion: 'skipped' },
      'Validate / Storage': { conclusion: 'skipped' },
      'Validate / Provider': { conclusion: 'skipped' },
      'Validate / Speech': { conclusion: 'skipped' },
      'Validate / Questions': { conclusion: 'skipped' },
      'Deferred / Build': { conclusion: 'success' },
    },
  });
  const found = await discover([valid, metadata, draft]);
  assert.equal(found.run.id, 13);
});

test('the current metadata run is excluded even while it is incomplete', async () => {
  const current = sourceRun(99, {
    status: 'in_progress',
    conclusion: null,
    createdAt: '2026-10-17T20:03:00Z',
  });
  const found = await discover([sourceRun(13), current]);
  assert.equal(found.run.id, 13);
});

test('discovery requires the current run ID and the Actions adapter supplies it', async () => {
  await assert.rejects(discover([sourceRun(13)], currentEvent({ currentRunId: undefined })));
  const adapter = readFileSync('scripts/ci/ios-ready-validation-evidence.mjs', 'utf8');
  assert.match(adapter, /currentRunId: process\.env\.GITHUB_RUN_ID/);
});

test('a successful rerun is ordered by its latest execution time', async () => {
  const rerun = sourceRun(13, { updatedAt: '2026-10-17T20:04:00Z' });
  rerun.run.run_attempt = 2;
  rerun.artifacts = rerun.artifacts.map(({ name, ...artifact }) => ({
    ...artifact,
    name: name.replace('-13-1', '-13-2'),
  }));
  const failed = sourceRun(14, {
    conclusion: 'failure',
    createdAt: '2026-10-17T20:02:00Z',
    updatedAt: '2026-10-17T20:02:00Z',
  });
  const found = await discover([failed, rerun]);
  assert.equal(found.run.id, 13);
  assert.equal(found.run.run_attempt, 2);
});
