import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { discoverReadyValidationCandidate } from '../ios-ready-validation-evidence-policy.mjs';

const READY_JOB_NAME_EXPRESSIONS = {
  coverage:
    "github.event_name == 'workflow_dispatch' && inputs.candidate_pr_number != '' && 'Candidate / Coverage' || 'Plan / Coverage'",
  completeness:
    "github.event_name == 'workflow_dispatch' && inputs.candidate_pr_number != '' && 'Candidate / Completeness' || 'Validate'",
  reuse:
    "github.event_name == 'workflow_dispatch' && inputs.candidate_pr_number != '' && 'Candidate / Reuse Ready evidence' || 'Reuse / Ready evidence'",
};

const ordinaryHead = 'a'.repeat(40);
const ordinaryBase = 'b'.repeat(40);
const ordinaryBranch = 'eunsoogi/issue-203-e2e-selection-ready-policy';

function sourceRun(id) {
  const run = {
    id,
    run_attempt: 1,
    status: 'completed',
    conclusion: 'success',
    event: 'pull_request',
    path: '.github/workflows/e2e-test.yml',
    head_sha: ordinaryHead,
    head_branch: ordinaryBranch,
    created_at: '2026-10-17T20:00:00Z',
    pull_requests: [
      {
        number: 205,
        base: { ref: 'main', sha: ordinaryBase },
        head: { ref: ordinaryBranch, sha: ordinaryHead },
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
  return {
    run,
    jobs,
    artifacts: [
      { name: `ios-e2e-selection-${id}-1`, expired: false },
      { name: `ios-e2e-results-${id}-1`, expired: false },
    ],
  };
}

function currentEvent(pullRequest = {}) {
  return {
    repository: 'eunsoogi/orot',
    event: 'pull_request',
    action: 'edited',
    currentRunId: '99',
    changes: { body: { from: 'old body' } },
    metadataOnlyEdit: true,
    selectionComplete: true,
    pullRequest: {
      number: 205,
      draft: false,
      baseSha: ordinaryBase,
      baseRef: 'main',
      headSha: ordinaryHead,
      headRef: ordinaryBranch,
      ...pullRequest,
    },
  };
}

function pr217SourceRun() {
  const candidate = sourceRun(39916330425);
  Object.assign(candidate.run, {
    head_sha: 'ef940ea1172e9843ee262fdae1b787e60410cf4c',
    head_branch: 'eunsoogi/issue-216-validation-policy',
    pull_requests: [
      {
        number: 217,
        base: { ref: 'main', sha: '5a75dd299cd1a352914fa5ae7580da90fa7f0ee5' },
        head: {
          ref: 'eunsoogi/issue-216-validation-policy',
          sha: 'ef940ea1172e9843ee262fdae1b787e60410cf4c',
        },
      },
    ],
  });

  // Actions returned this exact skipped-job payload for PR run 39916330425.
  Object.assign(
    candidate.jobs.find(({ name }) => name === 'Reuse / Ready evidence'),
    {
      id: 120333925801,
      name: READY_JOB_NAME_EXPRESSIONS.reuse,
      status: 'completed',
      conclusion: 'skipped',
    },
  );
  return candidate;
}

function discover(candidate, current = currentEvent()) {
  return discoverReadyValidationCandidate(
    {
      listRuns: async () => [candidate.run],
      listJobs: async () => candidate.jobs,
      listArtifacts: async () => candidate.artifacts,
    },
    current,
  );
}

test('reuses PR 217 evidence when Actions returns the captured skipped reuse job name', async () => {
  const current = currentEvent({
    number: 217,
    baseSha: '5a75dd299cd1a352914fa5ae7580da90fa7f0ee5',
    headSha: 'ef940ea1172e9843ee262fdae1b787e60410cf4c',
    headRef: 'eunsoogi/issue-216-validation-policy',
  });
  const found = await discover(pr217SourceRun(), current);

  assert.equal(found.run.id, 39916330425);
  assert.equal(found.jobs.find(({ id }) => id === 120333925801).conclusion, 'skipped');
});

test('skipped job payload expressions stay aligned with the workflow identities', () => {
  const workflow = readFileSync('.github/workflows/e2e-test.yml', 'utf8');

  for (const expression of Object.values(READY_JOB_NAME_EXPRESSIONS))
    assert.ok(workflow.includes(`name: \${{ ${expression} }}`), expression);
});

test('recognizes captured skipped coverage and completion names for an empty Ready selection', async () => {
  const candidate = sourceRun(16);
  const coverage = candidate.jobs.find(({ name }) => name === 'Plan / Coverage');
  coverage.name = READY_JOB_NAME_EXPRESSIONS.coverage;
  coverage.conclusion = 'skipped';
  const completionIndex = candidate.jobs.findIndex(({ name }) => name === 'Validate / Complete');
  candidate.jobs.splice(completionIndex, 1, {
    name: READY_JOB_NAME_EXPRESSIONS.completeness,
    status: 'completed',
    conclusion: 'skipped',
  });
  candidate.artifacts = candidate.artifacts.filter(
    ({ name }) => !name.startsWith('ios-e2e-results-'),
  );

  const found = await discover(candidate);

  assert.equal(found.run.id, 16);
});

test('a Candidate workflow dispatch cannot become a Ready evidence source', async () => {
  const candidate = sourceRun(17);
  candidate.run.event = 'workflow_dispatch';
  candidate.jobs.find(({ name }) => name === 'Reuse / Ready evidence').name =
    READY_JOB_NAME_EXPRESSIONS.reuse;

  await assert.rejects(discover(candidate), /No successful Ready validation/);
});
