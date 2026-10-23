import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { REQUIRED_CI_JOBS_BY_WORKFLOW } from '../../release/ci-required-jobs.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const workflow = (path) => yaml.load(readFileSync(path, 'utf8'));

test('nightly E2E receipt is outside the PR required-check namespace', () => {
  const e2e = workflow('.github/workflows/e2e-test.yml');
  assert.equal(REQUIRED_CI_JOBS_BY_WORKFLOW['.github/workflows/e2e-test.yml'], undefined);
  assert.equal(e2e.jobs.completeness.uses, './.github/workflows/ios-test-completeness.yml');
  assert.ok(e2e.jobs.completeness.needs.includes('authentication'));
});

function resolveDefaultJobName(name) {
  return name.replace(
    /\$\{\{\s*github\.event_name == 'workflow_dispatch' && inputs\.candidate_pr_number != '' && 'Candidate \/ [^']+' \|\| '([^']+)'\s*\}\}/g,
    '$1',
  );
}

test('scheduled cohort jobs use one consistent role and target', () => {
  const root = workflow('.github/workflows/e2e-test.yml');
  assert.equal(root.name, 'E2E Test');
  assert.equal(
    root.jobs.ios_validation,
    undefined,
    'The redundant Full display wrapper must be absent',
  );
  const entry = root.jobs;
  const full = Object.fromEntries(
    Object.entries(entry).filter(
      ([id]) =>
        id !== 'authentication' && [...entry.completeness.needs, 'completeness'].includes(id),
    ),
  );
  const names = [];
  for (const job of Object.values(full)) {
    const jobName = resolveDefaultJobName(job.name);
    if (!job.uses) {
      names.push(jobName);
      continue;
    }
    const leaves = Object.values(workflow(job.uses.replace(/^\.\//, '')).jobs);
    // A matrix caller adds raw parameter suffixes in GitHub. Each feature therefore has one explicit call.
    assert.equal(job.strategy, undefined);
    for (const leaf of leaves) {
      const name = leaf.name.replace('${{ inputs.name }}', job.with?.name);
      if (
        /^\.\/\.github\/workflows\/ios-(question|navigation|calendar|recording)-tests\.yml$/.test(
          leaf.uses ?? '',
        )
      ) {
        for (const question of Object.values(workflow(leaf.uses).jobs))
          names.push([jobName, name, question.name].join(' / '));
      } else names.push([jobName, name].join(' / '));
    }
  }
  const expected = [
    'Plan / Coverage',
    'Plan / Select',
    'Validate / Complete',
    ...['Debug', 'Release', 'Production', 'OAuth'].map((name) => 'Build / ' + name),
    ...iosTestExecutionPlan().map((item) => 'Test / ' + item.name),
    'Test / OAuth',
  ];
  assert.deepEqual(names.sort(), expected.sort());
  assert.equal(new Set(names).size, names.length);
  for (const name of names) {
    const visible = root.name + ' / ' + name;
    assert.equal(visible.match(/E2E/g)?.length, 1);
    assert.doesNotMatch(name, /\$\{\{|[()\d]/);
  }
});

test('full integration execution preserves 112 observations and every registered provider case', () => {
  const scheduled = ['release', 'speech', 'debug'].flatMap((cohort) =>
    iosTestCohortTasks(cohort).flatMap((task) => task.identifiers),
  );
  // Release76 + Debug27 + Speech9 retain each release case and the added regressions.
  assert.equal(scheduled.length, 112);
  const identifiers = new Set(scheduled);
  assert.equal(identifiers.size, 112);
  const provider = iosTestInventory('provider-data');
  const expectedProvider = [
    'AppleNativeToolLifecycleTests/testCallbackResultDrainsBeforeFreshGeneration',
    'AppleNativeToolLifecycleTests/testCancellationReleasesWaitingCallback',
    'AppleNativeToolLifecycleTests/testDrainFailureDoesNotStartFreshGeneration',
    'AppleNativeToolLifecycleTests/testSecondCallbackDuringDrainIsRejected',
    'AppleNativeToolLifecycleTests/testCancellationDuringDrainReleasesTheNextRequest',
    'AppleNativeToolLifecycleTests/testWatchdogReleasesAnOrphanedCallback',
    'AppleNativeToolLifecycleTests/testParallelCallbackFailsWithoutPublishingAnotherTool',
    'RagWorkflowIntegrationTests/testPublicRetrievalReturnsAnAnswerWithGroundedCitations',
    'AppleModelIntegrationTests/testStreamingFailurePreservesKnownNativeDecisions',
    'AppleModelIntegrationTests/testMockAvailabilityGenerationStreamingCancellationAndFailures',
    'AppleWorkflowIntegrationTests/testMockCalendarClassificationCitedQuestionsAndWorkflowCancellation',
    'AppleWorkflowIntegrationTests/testThreeMockCalendarClassificationsAndTwoImportsKeepOneMedicalOccurrence',
    'ProviderIntegrationTests/testSyntheticCatalogStreamLimitAndCancellationUseProviderBridge',
    'ProviderIntegrationTests/testSyntheticToolDefinitionAndLocalResultRoundTripUseProviderBridge',
    'MedicationDoseCursorTests/testCatalogShrinkageAndEmptyVisibilityRetainDeletionScope',
    'MedicationDoseCursorTests/testReplayExpansionAndErrorsPreserveCheckpointInvariants',
    'HealthIntegrationTests/testAuthorizationScopesAndSyntheticSamplesStayExplicit',
    'HealthIntegrationTests/testSyntheticSleepNormalizationAndAnchorResume',
  ].map((name) => `OrotIntegrationTests/${name}`);
  // Exact identities preserve old cases plus streaming/dose regressions; a count can hide replacements.
  assert.deepEqual([...provider].sort(), expectedProvider.sort());
  for (const identifier of provider) assert.ok(identifiers.has(identifier));
  const workflowSource = readFileSync('.github/workflows/e2e-test.yml', 'utf8');
  assert.doesNotMatch(
    workflowSource,
    /supported-provider-receipt|availability.*skip|continue-on-error/,
  );
  const mapping = readFileSync('docs/ios-validation.md', 'utf8');
  const [replacements, classification] = mapping.split(
    '## Requirement classification, reset and cost',
  );
  const expectedRequirements = Array.from(
    { length: 55 },
    (_, index) => `N${String(index + 1).padStart(3, '0')}`,
  );
  // Each table must cover all original requirements once; a duplicated row cannot hide a missing requirement.
  for (const table of [replacements, classification]) {
    const requirements = [...table.matchAll(/^\| (N\d{3}) \|/gm)].map((match) => match[1]);
    assert.deepEqual(requirements, expectedRequirements);
  }
});

test('removes unavailable Simulator devices before preparing iOS test products', () => {
  const steps = workflow('.github/actions/ios-test-products-build/action.yml').runs.steps;
  const toolchainIndex = steps.findIndex(
    (step) => step.uses === './.github/actions/ios-native-toolchain',
  );
  const cleanupIndex = steps.findIndex(
    (step) => step.name === 'Remove unavailable Simulator devices',
  );
  const dependenciesIndex = steps.findIndex(
    (step) => step.uses === './.github/actions/ios-platform-dependencies',
  );
  const buildIndex = steps.findIndex((step) => step.name === 'Build without booting a Simulator');

  // Keep Xcode's device scan after unavailable runtime records have been removed and warning-checked.
  assert.ok(toolchainIndex < cleanupIndex && cleanupIndex < dependenciesIndex);
  assert.ok(dependenciesIndex < buildIndex);
  assert.equal(steps[cleanupIndex].shell, 'bash');
  assert.equal(
    steps[cleanupIndex].run,
    'scripts/ci/run-command.sh ios-simulator-cleanup artifacts/ios-simulator-cleanup.log -- node scripts/ci/fail-on-warning.mjs -- xcrun simctl delete unavailable',
  );
});
