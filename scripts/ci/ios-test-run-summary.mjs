import { iosTestCohortTasks } from './ios-test-cohorts.mjs';
import { IOS_TEST_COHORT_NAMES, iosTestExecutionPlan } from './ios-test-execution-plan.mjs';
import { iosTestInventory } from './ios-test-inventory.mjs';
import {
  authenticationCases,
  caseReport,
  countStatuses,
  exactReport,
  jobStatus,
  makeCase,
} from './ios-test-run-summary-cases.mjs';
import { firstFailuresFor, summarizedGroup } from './ios-test-run-summary-projections.mjs';

/** Build diagnostic coverage without weakening the separate first-attempt acceptance verifier. */
export function buildIosTestRunSummary({
  selectedCohorts,
  reports = [],
  authenticationReport,
  executionResults = {},
  oauthRequired = false,
  validationTier,
  context = {},
  timing,
  root = process.cwd(),
  inventory = {
    names: IOS_TEST_COHORT_NAMES,
    plan: iosTestExecutionPlan,
    tasks: iosTestCohortTasks,
    cases: iosTestInventory,
  },
}) {
  const { names, plan, tasks, cases: testInventory } = inventory;
  const requestedCohorts = Array.isArray(selectedCohorts) ? selectedCohorts : [];
  let selectedPlan = [];
  let selectionError;
  try {
    selectedPlan = plan(requestedCohorts);
  } catch (error) {
    selectionError = String(error.message);
  }

  const reportBuckets = new Map();
  const staleReports = [];
  const unexpectedReports = [];
  for (const entry of reports) {
    const report = entry.report;
    if (!exactReport(report, context)) {
      staleReports.push({
        artifactName: entry.artifactName,
        cohort: report?.cohort,
        sourceSha: report?.sourceSha,
        runId: report?.runId,
        attempt: report?.attempt,
      });
      continue;
    }
    if (!names.includes(report.cohort)) {
      unexpectedReports.push({ artifactName: entry.artifactName, cohort: report.cohort });
      continue;
    }
    if (!selectedPlan.some((item) => item.cohort === report.cohort)) {
      unexpectedReports.push({
        artifactName: entry.artifactName,
        cohort: report.cohort,
        reason: 'cohort was not selected for this run',
      });
      continue;
    }
    const bucket = reportBuckets.get(report.cohort) ?? [];
    bucket.push(report);
    reportBuckets.set(report.cohort, bucket);
  }

  const cases = [];
  const unexpectedObservations = [];
  for (const entry of plan(names)) {
    const category = entry.cohort === 'speech' ? 'speech' : 'ordinaryIphone';
    const selected = !selectionError && requestedCohorts.includes(entry.cohort);
    if (!selected) {
      for (const task of tasks(entry.cohort))
        for (const identifier of task.identifiers)
          cases.push(
            makeCase(
              category,
              entry.cohort,
              identifier,
              selectionError ? 'unknown' : 'not-selected',
              context,
              root,
            ),
          );
      continue;
    }
    const bucket = reportBuckets.get(entry.cohort) ?? [];
    if (bucket.length > 1) {
      for (const task of tasks(entry.cohort))
        for (const identifier of task.identifiers)
          cases.push(
            makeCase(category, entry.cohort, identifier, 'duplicate', context, root, undefined, {
              reportCount: bucket.length,
            }),
          );
      continue;
    }
    const result = caseReport(entry, bucket[0], category, context, root, executionResults, tasks);
    for (const identifier of result.unexpected)
      unexpectedObservations.push({ cohort: entry.cohort, identifier });
    if (!bucket.length && staleReports.some((item) => item.cohort === entry.cohort))
      result.cases.forEach((item) => (item.status = 'stale'));
    cases.push(...result.cases);
  }

  // Duo requirements are separate, opt-in inventory and never flow into iPhone totals.
  const duoCases = testInventory('duo').map((identifier) =>
    makeCase('duo', 'duo', identifier, 'not-selected', context, root),
  );
  cases.push(...duoCases);
  // Candidate runs use focused receipts and do not include the Full Keychain job.
  const fullTierSelected = validationTier === 'full';
  const authenticationSelected = fullTierSelected;
  let authReport = authenticationReport;
  if (authReport && !exactReport(authReport, context)) {
    staleReports.push({
      artifactName: 'ios-focused-execution',
      cohort: 'authentication',
      sourceSha: authReport.sourceSha,
      runId: authReport.runId,
      attempt: authReport.attempt,
    });
    authReport = undefined;
  }
  cases.push(
    ...authenticationCases(
      authReport,
      authenticationSelected,
      context,
      root,
      executionResults,
      testInventory,
    ),
  );

  const selectedCohortNames = new Set(selectedPlan.map((item) => item.cohort));
  const selectedCases = cases.filter((item) => {
    if (item.status === 'not-selected') return false;
    if (item.category === 'authentication') return authenticationSelected;
    return selectedCohortNames.has(item.cohort);
  });
  const uniqueReports = [...reportBuckets].filter(([, bucket]) => bucket.length === 1);
  const expensiveCases = selectedCases
    .filter((item) => Number.isFinite(item.durationMs))
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 10);
  const expensiveTasks = uniqueReports
    .flatMap(([cohort, bucket]) =>
      (bucket[0].tasks ?? [])
        .filter((task) => Number.isFinite(task.elapsedMs))
        .map((task) => ({
          cohort,
          profile: task.profile,
          suite: task.suite,
          elapsedMs: task.elapsedMs,
          status: task.status,
        })),
    )
    .sort((a, b) => b.elapsedMs - a.elapsedMs)
    .slice(0, 10);
  const validReports = uniqueReports.flatMap(([, bucket]) => bucket);
  return {
    schemaVersion: 1,
    provenance: { ...context },
    selection: {
      valid: !selectionError,
      ...(selectionError ? { error: selectionError } : {}),
      validationTier: validationTier ?? 'unknown',
      fullInventorySelected:
        !selectionError &&
        selectedPlan.length === names.length &&
        names.every((cohort) => selectedPlan.some((item) => item.cohort === cohort)),
      selectedCohorts: selectedPlan.map((item) => item.cohort),
      notSelectedCohorts: names.filter(
        (name) => !selectedPlan.some((item) => item.cohort === name),
      ),
    },
    coverage: {
      ordinaryIphone: summarizedGroup(
        cases.filter((item) => item.category === 'ordinaryIphone'),
        {
          selected: !selectionError && selectedPlan.some((item) => item.cohort !== 'speech'),
        },
      ),
      duo: summarizedGroup(duoCases, {
        selected: false,
        selectionReason: 'Duo validation is an opt-in inventory outside the Full iPhone plan.',
      }),
      speech: summarizedGroup(
        cases.filter((item) => item.category === 'speech'),
        {
          selected: !selectionError && selectedPlan.some((item) => item.cohort === 'speech'),
        },
      ),
      authentication: {
        ...summarizedGroup(
          cases.filter((item) => item.category === 'authentication'),
          {
            selected: authenticationSelected,
          },
        ),
        jobStatus: authenticationSelected
          ? jobStatus(executionResults?.authentication?.result)
          : 'not-selected',
      },
      oauth: {
        selected: fullTierSelected && oauthRequired,
        status:
          fullTierSelected && oauthRequired
            ? jobStatus(executionResults?.oauth_execution?.result)
            : 'not-selected',
        productsStatus:
          fullTierSelected && oauthRequired
            ? jobStatus(executionResults?.oauth_products?.result)
            : 'not-selected',
        caseCount: null,
      },
      production: {
        selected: fullTierSelected,
        status: fullTierSelected
          ? jobStatus(executionResults?.production_validation?.result)
          : 'not-selected',
        caseCount: null,
      },
    },
    counts: countStatuses(cases),
    selectedCaseCount: selectedCases.length,
    cases,
    firstFailures: firstFailuresFor(new Map(uniqueReports), context, root, tasks),
    staleReports,
    unexpectedReports,
    unexpectedObservations,
    timing: timing ?? null,
    expensiveCases,
    expensiveTasks,
    exactReports: validReports.length,
  };
}
