import { IOS_TEST_COHORT_NAMES } from '../../ios-test-execution-plan.mjs';
import { iosTestCohortTasks } from '../../ios-test-cohorts.mjs';

// Keep fixtures aligned with the versioned artifacts used by Ready evidence reuse.
export const headSha = 'a'.repeat(40);
export const baseSha = 'b'.repeat(40);
export const sourceSha = 'c'.repeat(40);
export const prNumber = 205;
export const headRef = 'eunsoogi/issue-203-e2e-selection-ready-policy';
export const attempt = '1';

export function currentEvent(overrides = {}) {
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

export function makeCandidate({ id = 13, selected = ['core-ui'], jobs = {}, artifacts = {} } = {}) {
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
    schemaVersion: 2,
    validationTier: 'pr',
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

export function completeResults(candidate) {
  const selected = candidate.selection.selectedCohorts;
  return {
    schemaVersion: 2,
    validationTier: 'pr',
    oauthRequired: false,
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
