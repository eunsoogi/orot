import assert from 'node:assert/strict';
import test from 'node:test';
import { IOS_TEST_COHORT_NAMES } from '../ios-test-execution-plan.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import {
  discoverReadyValidationCandidate,
  verifyReusableReadyResults,
  verifyReusableReadySelection,
} from '../ios-ready-validation-evidence-policy.mjs';

const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const sourceSha = 'c'.repeat(40);
const prNumber = 205;
const headRef = 'eunsoogi/issue-203-e2e-selection-ready-policy';
const attempt = '1';

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

function makeCandidate({ id = 13, selected = ['core-ui'], jobs = {}, artifacts = {} } = {}) {
  const run = {
    id,
    run_attempt: Number(attempt),
    status: 'completed',
    conclusion: 'success',
    event: 'pull_request',
    path: '.github/workflows/e2e-test.yml',
    head_sha: headSha,
    head_branch: headRef,
    created_at: '2026-10-17T20:49:58Z',
    html_url: `https://github.com/eunsoogi/orot/actions/runs/${id}`,
    pull_requests: [
      {
        number: prNumber,
        base: { ref: 'main', sha: baseSha },
        head: { ref: headRef, sha: headSha },
      },
    ],
  };
  const names = [
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
  ];
  const jobList = names.map((name) => ({
    name,
    status: 'completed',
    conclusion: name === 'Reuse / Ready evidence' ? 'skipped' : 'success',
    ...jobs[name],
  }));
  const artifactList = [
    { name: `ios-e2e-selection-${id}-${attempt}`, expired: false },
    { name: `ios-e2e-results-${id}-${attempt}`, expired: false },
  ].map((artifact) => ({ ...artifact, ...artifacts[artifact.name] }));
  const selection = {
    schemaVersion: 1,
    event: 'pull_request',
    action: 'ready_for_review',
    sourceSha,
    runId: String(id),
    attempt,
    ref: `refs/pull/${prNumber}/merge`,
    pullRequest: { number: prNumber, draft: false, baseSha, headSha },
    selectionComplete: true,
    selectedCohorts: selected,
    notSelectedCohorts: IOS_TEST_COHORT_NAMES.filter((cohort) => !selected.includes(cohort)),
    oauthSelected: false,
    fullValidationDeferred: false,
    metadataOnlyEdit: false,
  };
  return { run, jobs: jobList, artifacts: artifactList, selection };
}

function completeResults(candidate) {
  const selected = candidate.selection.selectedCohorts;
  return {
    sourceSha,
    runId: String(candidate.run.id),
    attempt,
    selectedCohorts: selected,
    notSelectedCohorts: IOS_TEST_COHORT_NAMES.filter((cohort) => !selected.includes(cohort)),
    executedCohorts: selected,
    notExecutedCohorts: [],
    observations: selected.flatMap((cohort) =>
      iosTestCohortTasks(cohort).flatMap((task) =>
        task.identifiers.map((identifier) => ({ identifier, result: 'Passed', duration: 1 })),
      ),
    ),
  };
}

test('draft, deferred, metadata, stale-base, stale-head, and missing-check runs are rejected', async () => {
  const variants = [
    (item) => (item.run.conclusion = 'failure'),
    (item) => (item.run.event = 'workflow_dispatch'),
    (item) => (item.run.pull_requests[0].base.sha = 'd'.repeat(40)),
    (item) =>
      (item.jobs.find(({ name }) => name === 'Reuse / Ready evidence').conclusion = 'success'),
    (item) =>
      (item.jobs.find(({ name }) => name === 'Validate / Questions').conclusion = 'failure'),
    (item) => (item.jobs.find(({ name }) => name === 'Validate / Build').conclusion = 'skipped'),
    (item) =>
      (item.artifacts.find(({ name }) => name.startsWith('ios-e2e-selection-')).expired = true),
    (item) =>
      (item.artifacts.find(({ name }) => name.startsWith('ios-e2e-results-')).expired = true),
  ];
  for (const mutate of variants) {
    const item = makeCandidate();
    mutate(item);
    await assert.rejects(
      discoverReadyValidationCandidate(
        {
          listRuns: async () => [item.run],
          listJobs: async () => item.jobs,
          listArtifacts: async () => item.artifacts,
        },
        currentEvent(),
      ),
    );
  }
});

test('a full Ready source report must bind to the current PR, head, base, run, and attempt', () => {
  const candidate = makeCandidate();
  const verified = verifyReusableReadySelection(candidate.selection, candidate, currentEvent());
  assert.deepEqual(verified.selectedCohorts, ['core-ui']);
  assert.equal(verified.oauthRequired, false);
  assert.equal(verified.sourceRunId, '13');
  for (const change of [
    (report) => (report.pullRequest.headSha = 'd'.repeat(40)),
    (report) => (report.pullRequest.baseSha = 'd'.repeat(40)),
    (report) => (report.pullRequest.draft = true),
    (report) => (report.metadataOnlyEdit = true),
    (report) => (report.fullValidationDeferred = true),
    (report) => (report.runId = '12'),
    (report) => (report.attempt = '2'),
    (report) => (report.notSelectedCohorts = []),
  ]) {
    const changed = structuredClone(candidate.selection);
    change(changed);
    assert.throws(() => verifyReusableReadySelection(changed, candidate, currentEvent()));
  }
});

test('source selection cannot turn a draft, deferred, or non-metadata current event into protected evidence', () => {
  const candidate = makeCandidate();
  for (const current of [
    currentEvent({ metadataOnlyEdit: false }),
    currentEvent({ action: 'synchronize', changes: undefined }),
    currentEvent({ changes: { base: { ref: { from: 'main', to: 'release' } } } }),
    currentEvent({ pullRequest: { ...currentEvent().pullRequest, draft: true } }),
  ])
    assert.throws(() => verifyReusableReadySelection(candidate.selection, candidate, current));
});

test('complete source observations must match every selected test identifier and pass', () => {
  const candidate = makeCandidate({ selected: ['core-ui'] });
  const complete = completeResults(candidate);
  assert.equal(
    verifyReusableReadyResults(candidate.selection, complete, candidate, currentEvent())
      .observationCount,
    complete.observations.length,
  );
  for (const mutate of [
    (report) => report.observations.pop(),
    (report) => (report.observations[0].result = 'Failed'),
    (report) => (report.notExecutedCohorts = ['core-ui']),
    (report) => (report.executedCohorts = []),
  ]) {
    const changed = structuredClone(complete);
    mutate(changed);
    assert.throws(() =>
      verifyReusableReadyResults(candidate.selection, changed, candidate, currentEvent()),
    );
  }
});

test('an exact Ready validation may explicitly select no iOS cohorts without inventing a result artifact', () => {
  const candidate = makeCandidate({ selected: [] });
  candidate.artifacts = candidate.artifacts.filter(({ name }) =>
    name.startsWith('ios-e2e-selection-'),
  );
  candidate.jobs.find(({ name }) => name === 'Plan / Coverage').conclusion = 'skipped';
  candidate.jobs = candidate.jobs.filter(({ name }) => name !== 'Validate / Complete');
  candidate.jobs.push({ name: 'Validate', status: 'completed', conclusion: 'skipped' });
  assert.deepEqual(verifyReusableReadySelection(candidate.selection, candidate, currentEvent()), {
    selectedCohorts: [],
    notSelectedCohorts: IOS_TEST_COHORT_NAMES,
    oauthRequired: false,
    hasSelectedCohorts: false,
    sourceRunId: '13',
    sourceAttempt: attempt,
  });
});
