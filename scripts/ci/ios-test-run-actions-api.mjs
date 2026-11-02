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
    const run = await requestJson(base, token, fetchImpl);
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
