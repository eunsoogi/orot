import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discoverReadyValidationCandidate,
  verifyReusableReadyResults,
  verifyReusableReadySelection,
} from '../ios-ready-validation-evidence-policy.mjs';
import {
  attempt,
  completeResults,
  currentEvent,
  makeCandidate,
} from './support/ios-ready-validation-evidence-fixtures.mjs';
import { IOS_TEST_COHORT_NAMES } from '../ios-test-execution-plan.mjs';

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
    (report) => (report.validationTier = 'full'),
    (report) => (report.schemaVersion = 1),
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
    (report) => (report.observations[0].identifier = 'OrotUITests/UnexpectedTests/testUnexpected'),
    (report) => (report.observations[1].identifier = report.observations[0].identifier),
    (report) => (report.observations[0].result = 'Failed'),
    (report) => (report.notExecutedCohorts = ['core-ui']),
    (report) => (report.executedCohorts = []),
    (report) => (report.validationTier = 'full'),
    (report) => (report.schemaVersion = 1),
    (report) => (report.oauthRequired = true),
    (report) => (report.observations[0].duration = -1),
    (report) => (report.observations[0].duration = Number.NaN),
    (report) => (report.observations[0].duration = Number.POSITIVE_INFINITY),
    (report) => (report.observations[0].duration = Number.NEGATIVE_INFINITY),
    (report) => (report.observations[0].duration = null),
    (report) => (report.observations[0].duration = '1'),
    (report) => (report.observations[0].duration = undefined),
  ]) {
    const changed = structuredClone(complete);
    mutate(changed);
    assert.throws(() =>
      verifyReusableReadyResults(candidate.selection, changed, candidate, currentEvent()),
    );
  }

  const zeroDuration = completeResults(candidate);
  zeroDuration.observations[0].duration = 0;
  assert.equal(
    verifyReusableReadyResults(candidate.selection, zeroDuration, candidate, currentEvent())
      .observationCount,
    zeroDuration.observations.length,
  );
});

test('complete source observations may arrive in a different order from the maintained inventory', () => {
  const candidate = makeCandidate({ selected: ['core-ui'] });
  const complete = completeResults(candidate);
  complete.observations.reverse();
  assert.equal(
    verifyReusableReadyResults(candidate.selection, complete, candidate, currentEvent())
      .observationCount,
    complete.observations.length,
  );
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
    validationTier: 'pr',
    selectedCohorts: [],
    notSelectedCohorts: IOS_TEST_COHORT_NAMES,
    oauthRequired: false,
    hasSelectedCohorts: false,
    sourceRunId: '13',
    sourceAttempt: attempt,
  });
});
