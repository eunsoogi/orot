import { IOS_TEST_COHORT_NAMES, iosTestExecutionPlan } from './ios-test-execution-plan.mjs';
import { iosTestCohortTasks } from './ios-test-cohorts.mjs';

// Metadata edits may reuse protected results only from a successful Ready run of this exact PR head and base.
const REQUIRED_SUCCESS_JOBS = [
  'Plan / Select',
  'Validate / Build',
  'Validate / UI',
  'Validate / Storage',
  'Validate / Provider',
  'Validate / Speech',
  'Validate / Questions',
];
const CONDITIONAL_JOBS = ['Plan / Coverage', 'Validate / Complete'];
// A successful reuse job cannot become a future source run, so evidence never chains through metadata edits.
const REUSE_JOB = 'Reuse / Ready evidence';
const SELECTION_PREFIX = 'ios-e2e-selection-';
const RESULTS_PREFIX = 'ios-e2e-results-';
const SHA = /^[a-f0-9]{40}$/;
const RUN_ID = /^[1-9]\d*$/;

function reject(message) {
  throw new Error(message);
}

function exactArray(actual, expected) {
  return Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected);
}

function validateCurrentEvent(current) {
  const pr = current?.pullRequest;
  const keys =
    current?.changes && typeof current.changes === 'object' ? Object.keys(current.changes) : [];
  if (
    current?.event !== 'pull_request' ||
    current?.action !== 'edited' ||
    current?.metadataOnlyEdit !== true ||
    current?.selectionComplete !== true ||
    pr?.draft !== false ||
    !Number.isSafeInteger(pr?.number) ||
    pr.number < 1 ||
    !SHA.test(pr?.baseSha ?? '') ||
    !SHA.test(pr?.headSha ?? '') ||
    !pr.baseRef ||
    !pr.headRef ||
    keys.length === 0 ||
    keys.some((key) => !['body', 'title'].includes(key))
  )
    reject('Reusable validation is available only for a complete non-draft body or title edit');
  if (!/^[^/]+\/[^/]+$/.test(current.repository ?? ''))
    reject('Reusable validation requires the current repository identity');
}

function jobConclusion(jobs, name) {
  const matches = jobs.filter((job) => job.name === name);
  return matches.length === 1 && matches[0].status === 'completed'
    ? matches[0].conclusion
    : undefined;
}

function matchingPullRequest(run, current) {
  return run.pull_requests?.some(
    (pr) =>
      pr.number === current.pullRequest.number &&
      pr.base?.ref === current.pullRequest.baseRef &&
      pr.base?.sha === current.pullRequest.baseSha &&
      pr.head?.ref === current.pullRequest.headRef &&
      pr.head?.sha === current.pullRequest.headSha,
  );
}

function expectedArtifactNames(run) {
  return {
    selection: `${SELECTION_PREFIX}${run.id}-${run.run_attempt}`,
    results: `${RESULTS_PREFIX}${run.id}-${run.run_attempt}`,
  };
}

function activeArtifact(artifacts, name) {
  return artifacts.some((artifact) => artifact.name === name && artifact.expired === false);
}

function eligibleRunContext(run, current) {
  if (
    !RUN_ID.test(String(run.id)) ||
    !Number.isSafeInteger(run.run_attempt) ||
    run.run_attempt < 1 ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.event !== 'pull_request' ||
    run.path !== '.github/workflows/e2e-test.yml' ||
    run.head_sha !== current.pullRequest.headSha ||
    run.head_branch !== current.pullRequest.headRef ||
    !matchingPullRequest(run, current)
  )
    return false;
  return true;
}

function eligibleJobs(jobs) {
  if (REQUIRED_SUCCESS_JOBS.some((name) => jobConclusion(jobs, name) !== 'success')) return false;
  if (CONDITIONAL_JOBS.some((name) => !['success', 'skipped'].includes(jobConclusion(jobs, name))))
    return false;
  return jobConclusion(jobs, REUSE_JOB) === 'skipped';
}

function eligibleRun(run, jobs, artifacts, current) {
  if (!eligibleRunContext(run, current) || !eligibleJobs(jobs)) return false;
  const names = expectedArtifactNames(run);
  return (
    activeArtifact(artifacts, names.selection) &&
    (jobConclusion(jobs, 'Validate / Complete') !== 'success' ||
      activeArtifact(artifacts, names.results))
  );
}

// Injected API calls keep discovery policy testable while production reads authenticated Actions data.
export async function discoverReadyValidationCandidate(api, current) {
  validateCurrentEvent(current);
  const runs = await api.listRuns(current);
  const ordered = [...runs].sort(
    (a, b) => Date.parse(b.created_at ?? 0) - Date.parse(a.created_at ?? 0),
  );
  for (const run of ordered) {
    if (!eligibleRunContext(run, current)) continue;
    const jobs = await api.listJobs(run);
    if (!eligibleJobs(jobs)) continue;
    const artifacts = await api.listArtifacts(run);
    if (eligibleRun(run, jobs, artifacts, current))
      return { run, jobs, artifacts: artifacts.map(({ name, expired }) => ({ name, expired })) };
  }
  reject('No successful Ready validation exists for this exact PR head and base');
}

function validateCandidate(candidate, current) {
  const { run, jobs, artifacts } = candidate ?? {};
  if (
    !run ||
    !Array.isArray(jobs) ||
    !Array.isArray(artifacts) ||
    !eligibleRun(run, jobs, artifacts, current)
  )
    reject('Reusable source run is missing or no longer satisfies the ready-validation policy');
  return expectedArtifactNames(run);
}

function validateCohorts(selected, notSelected) {
  if (!Array.isArray(selected) || new Set(selected).size !== selected.length)
    reject('Source selection must list unique iOS cohorts');
  const canonicalSelected = IOS_TEST_COHORT_NAMES.filter((cohort) => selected.includes(cohort));
  if (canonicalSelected.length !== selected.length || !exactArray(selected, canonicalSelected))
    reject('Source selection must use the maintained cohort order and names');
  const expectedNotSelected = IOS_TEST_COHORT_NAMES.filter((cohort) => !selected.includes(cohort));
  if (!exactArray(notSelected, expectedNotSelected))
    reject('Source selection omits or duplicates the non-selected cohort inventory');
  return expectedNotSelected;
}

function validateSelectionReport(selection, candidate, current) {
  const names = validateCandidate(candidate, current);
  const run = candidate.run;
  if (
    selection?.schemaVersion !== 1 ||
    selection.event !== 'pull_request' ||
    !['opened', 'synchronize', 'reopened', 'ready_for_review', 'edited'].includes(
      selection.action,
    ) ||
    !SHA.test(selection.sourceSha ?? '') ||
    String(selection.runId) !== String(run.id) ||
    String(selection.attempt) !== String(run.run_attempt) ||
    selection.ref !== `refs/pull/${current.pullRequest.number}/merge` ||
    selection.selectionComplete !== true ||
    selection.pullRequest?.number !== current.pullRequest.number ||
    selection.pullRequest?.draft !== false ||
    selection.pullRequest?.baseSha !== current.pullRequest.baseSha ||
    selection.pullRequest?.headSha !== current.pullRequest.headSha ||
    selection.fullValidationDeferred !== false ||
    selection.metadataOnlyEdit !== false ||
    typeof selection.oauthSelected !== 'boolean'
  )
    reject('Source selection does not prove a complete Ready run for this PR head and base');
  const notSelectedCohorts = validateCohorts(
    selection.selectedCohorts,
    selection.notSelectedCohorts,
  );
  const selected = selection.selectedCohorts;
  const plan = jobConclusion(candidate.jobs, 'Plan / Coverage');
  const complete = jobConclusion(candidate.jobs, 'Validate / Complete');
  if (selected.length > 0) {
    if (
      plan !== 'success' ||
      complete !== 'success' ||
      !activeArtifact(candidate.artifacts, names.results)
    )
      reject('Selected source cohorts require successful coverage and complete result evidence');
  } else if (plan !== 'skipped' || complete !== 'skipped' || selection.oauthSelected) {
    reject('An empty source selection requires explicit skipped execution and no OAuth suite');
  }
  iosTestExecutionPlan();
  return {
    selectedCohorts: selected,
    notSelectedCohorts,
    oauthRequired: selection.oauthSelected,
    hasSelectedCohorts: selected.length > 0,
    sourceRunId: String(run.id),
    sourceAttempt: String(run.run_attempt),
  };
}

export function verifyReusableReadySelection(selection, candidate, current) {
  validateCurrentEvent(current);
  return validateSelectionReport(selection, candidate, current);
}

export function verifyReusableReadyResults(selection, complete, candidate, current) {
  const verified = verifyReusableReadySelection(selection, candidate, current);
  if (!verified.hasSelectedCohorts)
    reject('An empty source selection must not include test observations');
  const expected = iosTestExecutionPlan(verified.selectedCohorts).flatMap(({ cohort }) =>
    iosTestCohortTasks(cohort).flatMap((task) => task.identifiers),
  );
  if (
    complete?.sourceSha !== selection.sourceSha ||
    String(complete.runId) !== verified.sourceRunId ||
    String(complete.attempt) !== verified.sourceAttempt ||
    !exactArray(complete.selectedCohorts, verified.selectedCohorts) ||
    !exactArray(complete.notSelectedCohorts, verified.notSelectedCohorts) ||
    !exactArray(complete.executedCohorts, verified.selectedCohorts) ||
    !exactArray(complete.notExecutedCohorts, []) ||
    !Array.isArray(complete.observations) ||
    complete.observations.length !== expected.length
  )
    reject('Source result artifact does not match its exact selected cohort inventory');
  for (let index = 0; index < expected.length; index += 1) {
    const observation = complete.observations[index];
    if (
      observation.identifier !== expected[index] ||
      observation.result !== 'Passed' ||
      !Number.isFinite(observation.duration) ||
      observation.duration < 0
    )
      reject('Source result artifact contains a missing, unexpected, or failed observation');
  }
  return { ...verified, observationCount: expected.length };
}
