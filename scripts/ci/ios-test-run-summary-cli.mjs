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
import { renderIosTestRunSummaryMarkdown } from './ios-test-run-summary-markdown.mjs';
import { readIosWorkflowTiming, summarizeIosTestRunTiming } from './ios-test-run-timing.mjs';

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

/** Publish a diagnostic artifact beside, and independently from, the strict completeness result. */
export async function writeIosTestRunSummary({
  reportDirectory,
  authenticationDirectory,
  outputPath,
  env = process.env,
  fetchImpl = fetch,
}) {
  const reportsRead = readReports(reportDirectory);
  const authenticationRead = readAuthenticationReport(authenticationDirectory);
  const selectedCohorts = jsonValue(env.OROT_IOS_TEST_COHORTS, []);
  const executionResults = jsonValue(env.OROT_IOS_EXECUTION_RESULTS, {});
  const repository = env.GITHUB_REPOSITORY ?? 'unknown/unknown';
  const serverUrl = env.GITHUB_SERVER_URL ?? 'https://github.com';
  const runId = env.GITHUB_RUN_ID;
  const attempt = env.GITHUB_RUN_ATTEMPT;
  const runUrl =
    runId && attempt
      ? `${serverUrl}/${repository}/actions/runs/${runId}/attempts/${attempt}`
      : undefined;
  const context = {
    sourceSha: env.GITHUB_SHA,
    runId,
    attempt,
    repository,
    serverUrl,
    runUrl,
  };
  const summary = buildIosTestRunSummary({
    selectedCohorts,
    reports: reportsRead.reports,
    authenticationReport: authenticationRead.report,
    executionResults,
    oauthRequired: env.OROT_IOS_OAUTH_REQUIRED === 'true',
    validationTier: env.OROT_IOS_VALIDATION_TIER,
    context,
    root: env.GITHUB_WORKSPACE ?? process.cwd(),
  });
  const timingApi = await readIosWorkflowTiming({
    repository,
    runId,
    attempt,
    sourceSha: context.sourceSha,
    token: env.GITHUB_TOKEN,
    apiUrl: env.GITHUB_API_URL,
    fetchImpl,
  });
  summary.timing = summarizeIosTestRunTiming({
    run: timingApi.run,
    jobs: timingApi.jobs ?? [],
    summary,
    reports: reportsRead.reports,
    selectedCohorts: summary.selection.selectedCohorts,
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
  const [reportDirectory, authenticationDirectory, outputPath] = process.argv.slice(2);
  if (!reportDirectory || !authenticationDirectory || !outputPath)
    throw new Error('iOS run summary requires report, authentication and output paths');
  await writeIosTestRunSummary({ reportDirectory, authenticationDirectory, outputPath });
}
