import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildIosTestRunSummary } from './ios-test-run-summary.mjs';
import { readSourceInventory } from './ios-test-run-source-inventory.mjs';
import { renderIosTestRunSummaryMarkdown } from './ios-test-run-summary-markdown.mjs';
import { iosWorkflowExecutionResults, readIosWorkflowTiming } from './ios-test-run-actions-api.mjs';
import { summarizeIosTestRunTiming } from './ios-test-run-timing.mjs';
import { recoverArchivedReports } from './ios-test-legacy-log.mjs';

function jsonValue(value, fallback) {
  try {
    return JSON.parse(value ?? '');
  } catch {
    return fallback;
  }
}

function readReports(directory) {
  if (!directory || !existsSync(directory)) return { reports: [], errors: [] };
  const reports = [];
  const errors = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(directory, entry.name, 'results.json');
    if (!existsSync(path)) continue;
    try {
      reports.push({ artifactName: entry.name, report: JSON.parse(readFileSync(path, 'utf8')) });
    } catch (error) {
      errors.push({ artifactName: entry.name, reason: String(error.message) });
    }
  }
  return { reports, errors };
}

function readAuthenticationReport(directory) {
  if (!directory || !existsSync(join(directory, 'results.json'))) return { report: undefined };
  try {
    return { report: JSON.parse(readFileSync(join(directory, 'results.json'), 'utf8')) };
  } catch (error) {
    return { report: undefined, error: String(error.message) };
  }
}

/** Use the archived manifest as the only source for a replay's validation scope. */
function readSourceSelection(path) {
  if (!path) return undefined;
  let selection;
  try {
    selection = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error('Could not read the archived run selection artifact: ' + String(error.message));
  }
  if (
    selection?.selectionComplete !== true ||
    selection.validationTier !== 'full' ||
    !/^[1-9][0-9]*$/.test(String(selection.runId ?? '')) ||
    !/^[1-9][0-9]*$/.test(String(selection.attempt ?? '')) ||
    !/^[a-f0-9]{40}$/i.test(selection.sourceSha ?? '') ||
    typeof selection.event !== 'string' ||
    !Array.isArray(selection.selectedCohorts) ||
    typeof selection.oauthSelected !== 'boolean'
  )
    throw new Error('Archived run selection metadata is incomplete or not a Full E2E selection');
  return selection;
}

/** Bind downloaded receipts to a completed source run before joining its job outcomes. */
function validateArchivedSource(selection, run, requestedRunId, requestedAttempt) {
  const expectedWorkflowPath = '.github/workflows/e2e-test.yml';
  const workflowPath = run?.path;
  // Actions may append the source branch after the exact workflow filename.
  const matchesWorkflowPath =
    workflowPath === expectedWorkflowPath || workflowPath?.startsWith(expectedWorkflowPath + '@');
  if (
    String(selection.runId) !== String(requestedRunId) ||
    String(selection.attempt) !== String(requestedAttempt)
  )
    throw new Error('Archived selection does not match the requested source run and attempt');
  if (
    !run ||
    String(run.id) !== String(requestedRunId) ||
    String(run.run_attempt) !== String(requestedAttempt) ||
    run.head_sha !== selection.sourceSha ||
    run.status !== 'completed' ||
    !matchesWorkflowPath ||
    run.event !== selection.event ||
    !['schedule', 'workflow_dispatch'].includes(run.event)
  )
    throw new Error('Archived Actions run does not match the completed Full selection artifact');
}

/** Publish a diagnostic beside strict completeness with separate source and publisher identities. */
export async function writeIosTestRunSummary({
  reportDirectory,
  authenticationDirectory,
  outputPath,
  sourceSelectionPath,
  sourceRoot,
  sourceInventory,
  env = process.env,
  fetchImpl = fetch,
}) {
  const reportsRead = readReports(reportDirectory);
  const authenticationRead = readAuthenticationReport(authenticationDirectory);
  const selection = readSourceSelection(sourceSelectionPath);
  if (
    !selection &&
    (env.OROT_IOS_SOURCE_RUN_ID !== undefined || env.OROT_IOS_SOURCE_ATTEMPT !== undefined)
  )
    throw new Error('Archived source run inputs require the exact selection artifact');
  const repository = env.GITHUB_REPOSITORY ?? 'unknown/unknown';
  const serverUrl = (env.GITHUB_SERVER_URL ?? 'https://github.com').replace(/\/$/, '');
  const runId = env.GITHUB_RUN_ID;
  const attempt = env.GITHUB_RUN_ATTEMPT;
  const runUrl =
    runId && attempt
      ? `${serverUrl}/${repository}/actions/runs/${runId}/attempts/${attempt}`
      : undefined;
  const context = {
    sourceSha: selection?.sourceSha ?? env.GITHUB_SHA,
    runId: selection ? (env.OROT_IOS_SOURCE_RUN_ID ?? selection.runId) : runId,
    attempt: selection ? (env.OROT_IOS_SOURCE_ATTEMPT ?? selection.attempt) : attempt,
    repository,
    serverUrl,
    runUrl: selection
      ? serverUrl +
        '/' +
        repository +
        '/actions/runs/' +
        (env.OROT_IOS_SOURCE_RUN_ID ?? selection.runId) +
        '/attempts/' +
        (env.OROT_IOS_SOURCE_ATTEMPT ?? selection.attempt)
      : runUrl,
  };
  const timingApi = await readIosWorkflowTiming({
    repository,
    runId: context.runId,
    attempt: context.attempt,
    sourceSha: context.sourceSha,
    token: env.GITHUB_TOKEN,
    apiUrl: env.GITHUB_API_URL,
    fetchImpl,
  });
  if (selection) {
    if (!timingApi.available)
      throw new Error('Could not verify archived Actions run identity: ' + timingApi.reason);
    validateArchivedSource(selection, timingApi.run, context.runId, context.attempt);
  }
  // Historical observations must be matched against the inventory that produced them.
  const inventory = selection
    ? (sourceInventory ?? (await readSourceInventory(sourceRoot, selection.sourceSha)))
    : undefined;
  const selectedCohorts = selection?.selectedCohorts ?? jsonValue(env.OROT_IOS_TEST_COHORTS, []);
  const executionResults = selection
    ? iosWorkflowExecutionResults(timingApi.jobs, selectedCohorts, inventory.plan)
    : jsonValue(env.OROT_IOS_EXECUTION_RESULTS, {});
  if (selection)
    reportsRead.reports = await recoverArchivedReports({
      reports: reportsRead.reports,
      jobs: timingApi.jobs,
      inventory,
      selectedCohorts,
      context,
      token: env.GITHUB_TOKEN,
      apiUrl: env.GITHUB_API_URL,
      fetchImpl,
    });
  const summary = buildIosTestRunSummary({
    selectedCohorts,
    reports: reportsRead.reports,
    authenticationReport: authenticationRead.report,
    executionResults,
    oauthRequired: selection ? selection.oauthSelected : env.OROT_IOS_OAUTH_REQUIRED === 'true',
    validationTier: selection?.validationTier ?? env.OROT_IOS_VALIDATION_TIER,
    context,
    root: selection
      ? (sourceRoot ?? env.GITHUB_WORKSPACE ?? process.cwd())
      : (env.GITHUB_WORKSPACE ?? process.cwd()),
    ...(inventory ? { inventory } : {}),
  });
  // Keep the report's publisher link distinct from its archived source provenance.
  summary.publication = {
    repository,
    workflow: env.GITHUB_WORKFLOW,
    workflowRef: env.GITHUB_WORKFLOW_REF,
    workflowSha: env.GITHUB_SHA,
    ref: env.GITHUB_REF,
    runId,
    attempt,
    runUrl,
  };
  summary.timing = summarizeIosTestRunTiming({
    run: timingApi.run,
    jobs: timingApi.jobs ?? [],
    summary,
    reports: reportsRead.reports,
    selectedCohorts: summary.selection.selectedCohorts,
    ...(inventory ? { inventory } : {}),
  });
  summary.timing.available = timingApi.available;
  if (!timingApi.available) summary.timing.reason = timingApi.reason;
  summary.reportReadErrors = [
    ...reportsRead.errors,
    ...(authenticationRead.error
      ? [{ artifactName: 'ios-focused-execution', reason: authenticationRead.error }]
      : []),
  ];
  mkdirSync(dirname(resolve(outputPath)), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(summary, null, 2) + '\n');
  const markdown = renderIosTestRunSummaryMarkdown(summary);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
  process.stdout.write(
    `IOS_TEST_RUN_SUMMARY run=${runId ?? 'unknown'} attempt=${attempt ?? 'unknown'} selected=${summary.selectedCaseCount} failures=${summary.counts.failed} taskFailures=${summary.firstFailures.length} missing=${summary.counts.missing}\n`,
  );
  return summary;
}

if (process.argv[1]?.endsWith('/ios-test-run-summary-cli.mjs')) {
  const [reportDirectory, authenticationDirectory, outputPath, sourceSelectionPath, sourceRoot] =
    process.argv.slice(2);
  if (!reportDirectory || !authenticationDirectory || !outputPath)
    throw new Error('iOS run summary requires report, authentication and output paths');
  await writeIosTestRunSummary({
    reportDirectory,
    authenticationDirectory,
    outputPath,
    sourceSelectionPath,
    sourceRoot,
  });
}
