import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyFocusedIosResults } from './ios-focused-results.mjs';
import { IOS_TEST_COHORT_NAMES, iosTestExecutionPlan } from './ios-test-execution-plan.mjs';
import { verifyIosTestCohortResults } from './ios-test-cohort-results.mjs';
import { isIosValidationTier, validateFullIosSelection } from './ios-validation-tier.mjs';

// Verify only the exact selected cohort reports, then preserve executed and excluded inventory separately.
const [directory, ...extra] = process.argv.slice(2);
let selectedCohorts;
try {
  selectedCohorts = JSON.parse(process.env.OROT_IOS_TEST_COHORTS ?? '');
} catch {
  throw new Error('Integration aggregation requires its exact selected cohort list');
}
if (
  !directory ||
  extra.length ||
  !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '') ||
  !/^[1-9]\d*$/.test(process.env.GITHUB_RUN_ID ?? '') ||
  !/^[1-9]\d*$/.test(process.env.GITHUB_RUN_ATTEMPT ?? '')
)
  throw new Error('Integration aggregation requires its actual workflow context');
const plan = iosTestExecutionPlan(selectedCohorts);
const validationTier = process.env.OROT_IOS_VALIDATION_TIER;
const oauthValue = process.env.OROT_IOS_OAUTH_TESTS;
if (!isIosValidationTier(validationTier))
  throw new Error('Integration aggregation requires a known validation tier');
if (oauthValue !== 'true' && oauthValue !== 'false')
  throw new Error('Integration aggregation requires the OAuth selection decision');
const oauthRequired = oauthValue === 'true';
// Candidate artifacts repeat the Full boundary without changing their separate provenance tier.
if (validationTier === 'full' || validationTier === 'candidate')
  validateFullIosSelection(selectedCohorts, oauthRequired);
const notSelectedCohorts = IOS_TEST_COHORT_NAMES.filter(
  (cohort) => !selectedCohorts.includes(cohort),
);
const artifact = (cohort) =>
  `ios-cohort-report-${cohort}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
const names = plan.map((entry) => artifact(entry.cohort)).sort();
if (JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify(names))
  throw new Error('Integration reports omit a selected cohort or include an unexpected report');
const context = {
  sourceSha: process.env.GITHUB_SHA,
  runId: process.env.GITHUB_RUN_ID,
  attempt: process.env.GITHUB_RUN_ATTEMPT,
};
const observations = plan.flatMap((entry) => {
  const report = JSON.parse(
    readFileSync(join(directory, artifact(entry.cohort), 'results.json'), 'utf8'),
  );
  return verifyIosTestCohortResults(report, entry.cohort, context);
});
const authenticationDirectory = process.env.OROT_IOS_AUTHENTICATION_EVIDENCE;
let authentication;
if (validationTier === 'full' || validationTier === 'candidate') {
  if (!authenticationDirectory)
    throw new Error(
      'Full integration aggregation requires same-run Keychain authentication evidence',
    );
  authentication = verifyFocusedIosResults(
    'ios/core',
    'apps/mobile/ios/OrotIntegrationTests/KeychainAuthenticationIntegrationTests.m',
    'group/authentication',
    authenticationDirectory,
    context,
  );
  if (authentication.authenticationObservations?.length !== 2)
    throw new Error('Full integration aggregation requires both protected Keychain observations');
} else if (authenticationDirectory) {
  throw new Error('Focused integration aggregation cannot include full authentication evidence');
}
if (selectedCohorts.includes('speech')) {
  // Speech assets and new-process persistence are verified only when that cohort ran.
  execFileSync(
    process.execPath,
    [
      'scripts/ci/speech-test-evidence.mjs',
      join(directory, artifact('speech'), 'speech-integration/attachments'),
      join(directory, 'speech-accuracy.json'),
    ],
    { stdio: 'inherit' },
  );
}
const receipt = {
  schemaVersion: 2,
  validationTier,
  oauthRequired,
  ...context,
  selectedCohorts,
  notSelectedCohorts,
  executedCohorts: selectedCohorts,
  notExecutedCohorts: [],
  observations,
};
if (authentication) {
  // Keep the two biometric cases separate from the unchanged 24-cohort observation inventory.
  receipt.authenticationObservations = authentication.authenticationObservations;
  receipt.authenticationEvidence = authentication.authenticationEvidence;
}
writeFileSync(join(directory, 'complete.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(
  `IOS_SELECTED_RESULTS_VERIFIED jobs=${plan.length} observations=${observations.length} authentication=${authentication?.selectedCases ?? 0} skipped=${notSelectedCohorts.length}`,
);
