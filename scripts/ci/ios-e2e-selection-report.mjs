import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { CHECK_KEYS } from './changed-paths-core.mjs';
import { IOS_TEST_COHORT_NAMES } from './ios-test-execution-plan.mjs';

function candidatePullRequest(selection) {
  if (selection.validation_tier !== 'candidate') return null;
  // Keep the verified PR identity with the selection artifact for run-level observation.
  const repository = process.env.GITHUB_REPOSITORY ?? '';
  const number = process.env.OROT_IOS_CANDIDATE_PR_NUMBER ?? '';
  const headRef = process.env.OROT_IOS_CANDIDATE_HEAD_REF ?? '';
  const headSha = process.env.OROT_IOS_CANDIDATE_HEAD_SHA ?? '';
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
    !/^[1-9]\d*$/.test(number) ||
    !Number.isSafeInteger(Number(number)) ||
    !headRef ||
    /[\0\r\n]/.test(headRef) ||
    !/^[a-f0-9]{40}$/i.test(headSha)
  )
    throw new Error('Candidate selection requires the verified PR identity and head SHA');
  return { repository, number: Number(number), headRef, headSha: headSha.toLowerCase() };
}

export function writeSelectionOutputs(selection, outputPath, fullValidationDeferred) {
  if (!outputPath && process.env.GITHUB_ACTIONS === 'true') {
    throw new Error('GitHub Actions did not provide an output file');
  }
  if (!outputPath) return;
  const lines = [
    'all=' + selection.all,
    'reason=' + selection.reason,
    'validation_tier=' + selection.validation_tier,
    'full_validation_deferred=' + fullValidationDeferred,
    'metadata_only_edit=' + selection.metadata_only_edit,
    'candidate_pr_number=' + (candidatePullRequest(selection)?.number ?? ''),
    'candidate_head_ref=' + (process.env.OROT_IOS_CANDIDATE_HEAD_REF ?? ''),
    'candidate_head_sha=' + (process.env.OROT_IOS_CANDIDATE_HEAD_SHA ?? ''),
    'ios_test_cohorts=' + JSON.stringify(selection.ios_test_cohorts),
    'ios_test_impact_reasons=' + JSON.stringify(selection.ios_test_impact_reasons),
  ];
  for (const key of CHECK_KEYS) lines.push(key + '=' + selection[key]);
  // Completion is written last so dependent jobs can distinguish a finished selection from failure.
  lines.push('selection_complete=true');
  appendFileSync(outputPath, lines.join('\n') + '\n');
}

export function writeSelectionReport(selection, eventName, payload, fullValidationDeferred) {
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  const selectedCohorts = selection.ios_test_cohorts;
  const notSelectedCohorts = IOS_TEST_COHORT_NAMES.filter(
    (cohort) => !selectedCohorts.includes(cohort),
  );
  const report = {
    schemaVersion: 2,
    validationTier: selection.validation_tier,
    event: eventName || 'unknown',
    action: payload?.action ?? null,
    sourceSha: process.env.GITHUB_SHA ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    ref: process.env.GITHUB_REF ?? null,
    pullRequest: payload?.pull_request
      ? {
          number: payload.pull_request.number ?? null,
          draft: payload.pull_request.draft === true,
          baseSha: payload.pull_request.base?.sha ?? null,
          headSha: payload.pull_request.head?.sha ?? null,
        }
      : null,
    candidatePullRequest: candidatePullRequest(selection),
    selectionComplete: true,
    reason: selection.reason,
    changedPaths: selection.paths,
    impactReasons: selection.ios_test_impact_reasons,
    runtimeTestImportAnalysis: selection.runtime_test_import_analysis,
    selectedCheckFamilies: CHECK_KEYS.filter((key) => selection[key]),
    selectedCohorts,
    notSelectedCohorts,
    oauthSelected: selection.ios_oauth,
    fullValidationDeferred,
    metadataOnlyEdit: selection.metadata_only_edit === true,
  };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/ios-e2e-selection.json', JSON.stringify(report, null, 2) + '\n');
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  // Keep source-unchanged metadata edits distinct from ordinary PR impact reports.
  const disposition = selection.metadata_only_edit
    ? 'metadata-only edit; no new E2E run is scheduled for the unchanged source head'
    : selection.validation_tier === 'pr'
      ? 'PR impact selection is report-only; Full E2E runs on the nightly main schedule'
      : fullValidationDeferred
        ? 'deferred until the pull request is ready for review'
        : selection.validation_tier === 'candidate'
          ? 'full candidate validation for the verified Draft PR head'
          : selection.validation_tier === 'diagnostic'
            ? 'diagnostic selection only; protected iOS validation is not scheduled'
            : selectedCohorts.length || selection.ios_oauth
              ? 'scheduled for automatic execution'
              : 'no iOS E2E tests selected';
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '## iOS E2E selection',
      '',
      `Tier: ${selection.validation_tier}.`,
      `Decision: ${disposition}.`,
      `Reason: ${selection.reason}.`,
      `Selected cohorts: ${selectedCohorts.join(', ') || 'none'}.`,
      `Not selected cohorts: ${notSelectedCohorts.join(', ') || 'none'}.`,
      `OAuth suite: ${selection.ios_oauth ? 'selected' : 'not selected'}.`,
      '',
      'The exact selection is saved in the `ios-e2e-selection` artifact.',
      '',
    ].join('\n'),
  );
}
