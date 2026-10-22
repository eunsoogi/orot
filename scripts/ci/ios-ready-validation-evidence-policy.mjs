import { IOS_TEST_COHORT_NAMES, iosTestExecutionPlan } from './ios-test-execution-plan.mjs';
import { iosTestCohortTasks } from './ios-test-cohorts.mjs';
import {
  activeArtifact,
  completionConclusion,
  jobConclusion,
  validateCandidate,
  validateCurrentEvent,
} from './ios-ready-validation-evidence-source-policy.mjs';

// Validate downloaded selection and result reports after source discovery binds the run to this PR edit.
const SHA = /^[a-f0-9]{40}$/;

function reject(message) {
  throw new Error(message);
}

function exactArray(actual, expected) {
  return Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected);
}

export { discoverReadyValidationCandidate } from './ios-ready-validation-evidence-source-policy.mjs';

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
    selection?.schemaVersion !== 2 ||
    selection.validationTier !== 'pr' ||
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
  const complete = completionConclusion(candidate.jobs);
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
    validationTier: selection.validationTier,
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
    complete?.schemaVersion !== 2 ||
    complete.validationTier !== 'pr' ||
    complete.oauthRequired !== selection.oauthSelected ||
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

  // Xcode's result order can differ from inventory order; membership and uniqueness bind the exact executed set.
  const expectedIdentifiers = new Set(expected);
  const observedIdentifiers = new Set();
  for (const observation of complete.observations) {
    if (
      !expectedIdentifiers.has(observation.identifier) ||
      observedIdentifiers.has(observation.identifier) ||
      observation.result !== 'Passed' ||
      !Number.isFinite(observation.duration) ||
      observation.duration < 0
    )
      reject('Source result artifact contains a missing, unexpected, or failed observation');
    observedIdentifiers.add(observation.identifier);
  }
  if (observedIdentifiers.size !== expected.length)
    reject('Source result artifact contains a missing, unexpected, or failed observation');
  return { ...verified, observationCount: expected.length };
}
