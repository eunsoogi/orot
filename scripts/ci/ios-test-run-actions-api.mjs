import { iosTestExecutionPlan } from './ios-test-execution-plan.mjs';

const maximumJobPages = 5;

async function requestJson(url, token, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub Actions API returned ${response.status}`);
  return response.json();
}

/** Read one bounded current-attempt Actions snapshot; unavailable timing stays diagnostic-only. */
export async function readIosWorkflowTiming({
  repository,
  runId,
  attempt,
  sourceSha,
  token,
  apiUrl = 'https://api.github.com',
  fetchImpl = fetch,
}) {
  if (!repository || !runId || !attempt || !token)
    return { available: false, reason: 'Actions API context or read token is unavailable' };
  try {
    const parts = repository.split('/');
    if (parts.length !== 2 || parts.some((part) => !part))
      return { available: false, reason: 'Actions repository identity is invalid' };
    let apiBase = apiUrl;
    while (apiBase.endsWith('/')) apiBase = apiBase.slice(0, -1);
    const repoPath = parts.map(encodeURIComponent).join('/');
    const runPath = encodeURIComponent(String(runId));
    const attemptPath = encodeURIComponent(String(attempt));
    const base = apiBase + '/repos/' + repoPath + '/actions/runs/' + runPath;
    // The run endpoint describes the latest retry, which may differ from the archived attempt.
    const run = await requestJson(base + '/attempts/' + attemptPath, token, fetchImpl);
    if (String(run.id) !== String(runId) || String(run.run_attempt) !== String(attempt))
      return {
        available: false,
        reason: 'Actions run identity does not match the requested attempt',
      };
    if (sourceSha && run.head_sha !== sourceSha)
      return {
        available: false,
        reason: 'Actions run source SHA does not match the executed artifacts',
      };
    const jobs = [];
    for (let page = 1; page <= maximumJobPages; page += 1) {
      const result = await requestJson(
        base + '/attempts/' + attemptPath + '/jobs?per_page=100&page=' + page,
        token,
        fetchImpl,
      );
      if (
        !Array.isArray(result.jobs) ||
        result.jobs.some(
          (job) =>
            String(job.run_id) !== String(runId) ||
            (job.run_attempt != null && String(job.run_attempt) !== String(attempt)),
        )
      )
        return {
          available: false,
          reason: 'Actions job records include a different run or attempt',
        };
      jobs.push(...result.jobs);
      if (result.jobs.length < 100) return { available: true, run, jobs };
    }
    return { available: false, reason: 'Actions job timing exceeds the bounded page limit' };
  } catch (error) {
    return { available: false, reason: String(error.message) };
  }
}

/** Reconstruct per-cohort missing-receipt status from one verified Actions attempt. */
export function iosWorkflowExecutionResults(
  jobs,
  selectedCohorts,
  executionPlan = iosTestExecutionPlan,
) {
  const plan = executionPlan(selectedCohorts);
  const resultForName = (name) => {
    const matches = jobs.filter((job) => job.name === name);
    if (matches.length !== 1 || typeof matches[0].conclusion !== 'string') return undefined;
    return { result: matches[0].conclusion };
  };
  const cohorts = Object.fromEntries(
    plan
      .map((entry) => [entry.cohort, resultForName('Test / ' + entry.name)])
      .filter(([, result]) => result),
  );
  return {
    cohorts,
    authentication: resultForName('Test / Keychain authentication'),
    oauth_products: resultForName('Build / OAuth'),
    oauth_execution: resultForName('Test / OAuth'),
    production_validation: resultForName('Build / Production'),
  };
}
