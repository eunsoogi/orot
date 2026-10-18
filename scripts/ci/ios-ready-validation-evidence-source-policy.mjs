// Bind metadata reuse to the newest exact-head Ready attempt and its complete evidence.
const REQUIRED_SUCCESS_JOBS = [
  'Plan / Select',
  'Validate / Build',
  'Validate / UI',
  'Validate / Storage',
  'Validate / Provider',
  'Validate / Speech',
  'Validate / Questions',
];
const REUSE_JOB = 'Reuse / Ready evidence';
const SELECTION_PREFIX = 'ios-e2e-selection-';
const RESULTS_PREFIX = 'ios-e2e-results-';
const RUN_ID = /^[1-9]\d*$/;
const SHA = /^[a-f0-9]{40}$/;

function reject(message) {
  throw new Error(message);
}

function exactJob(jobs, name) {
  const matches = jobs.filter((job) => job.name === name);
  return matches.length === 1 ? matches[0] : undefined;
}

export function jobConclusion(jobs, name) {
  const job = exactJob(jobs, name);
  return job?.status === 'completed' ? job.conclusion : undefined;
}

// GitHub reports a skipped reusable workflow through its caller, without the child leaf job.
export function completionConclusion(jobs) {
  const leaf = exactJob(jobs, 'Validate / Complete');
  const caller = exactJob(jobs, 'Validate');
  if (Boolean(leaf) === Boolean(caller)) return undefined;
  if (caller)
    return caller.status === 'completed' && caller.conclusion === 'skipped' ? 'skipped' : undefined;
  return leaf.status === 'completed' ? leaf.conclusion : undefined;
}

export function validateCurrentEvent(current) {
  const pr = current?.pullRequest;
  const keys =
    current?.changes && typeof current.changes === 'object' ? Object.keys(current.changes) : [];
  if (
    current?.event !== 'pull_request' ||
    current?.action !== 'edited' ||
    !RUN_ID.test(String(current?.currentRunId ?? '')) ||
    current?.metadataOnlyEdit !== true ||
    current?.selectionComplete !== true ||
    pr?.draft !== false ||
    !Number.isSafeInteger(pr?.number) ||
    pr.number < 1 ||
    !SHA.test(pr?.baseSha ?? '') ||
    !SHA.test(pr?.headSha ?? '') ||
    !pr.baseRef ||
    !pr.headRef ||
    keys.length === 0 ||
    keys.some((key) => !['body', 'title'].includes(key))
  )
    reject('Reusable validation is available only for a complete non-draft body or title edit');
  if (!/^[^/]+\/[^/]+$/.test(current.repository ?? ''))
    reject('Reusable validation requires the current repository identity');
}

function matchingPullRequest(run, current) {
  return run.pull_requests?.some(
    (pr) =>
      pr.number === current.pullRequest.number &&
      pr.base?.ref === current.pullRequest.baseRef &&
      pr.base?.sha === current.pullRequest.baseSha &&
      pr.head?.ref === current.pullRequest.headRef &&
      pr.head?.sha === current.pullRequest.headSha,
  );
}

export function expectedArtifactNames(run) {
  return {
    selection: `${SELECTION_PREFIX}${run.id}-${run.run_attempt}`,
    results: `${RESULTS_PREFIX}${run.id}-${run.run_attempt}`,
  };
}

export function activeArtifact(artifacts, name) {
  return artifacts.some((artifact) => artifact.name === name && artifact.expired === false);
}

function matchesReadyRunContext(run, current) {
  return (
    RUN_ID.test(String(run.id)) &&
    String(run.id) !== String(current.currentRunId) &&
    Number.isSafeInteger(run.run_attempt) &&
    run.run_attempt > 0 &&
    run.event === 'pull_request' &&
    run.path === '.github/workflows/e2e-test.yml' &&
    run.head_sha === current.pullRequest.headSha &&
    run.head_branch === current.pullRequest.headRef &&
    matchingPullRequest(run, current)
  );
}

// Drafts publish Deferred jobs, metadata edits execute Reuse, and Ready runs skip Reuse.
function sourceRunKind(jobs) {
  if (jobs.some((job) => job.name.startsWith('Deferred /'))) return 'deferred';
  const reuse = exactJob(jobs, REUSE_JOB);
  if (!reuse || reuse.status !== 'completed') return 'incomplete';
  if (reuse.conclusion === 'skipped') return 'ready';
  return typeof reuse.conclusion === 'string' ? 'metadata' : 'incomplete';
}

function eligibleReadyJobs(jobs) {
  if (REQUIRED_SUCCESS_JOBS.some((name) => jobConclusion(jobs, name) !== 'success')) return false;
  if (!['success', 'skipped'].includes(jobConclusion(jobs, 'Plan / Coverage'))) return false;
  return ['success', 'skipped'].includes(completionConclusion(jobs));
}

function eligibleReadyArtifacts(run, jobs, artifacts) {
  const names = expectedArtifactNames(run);
  return (
    activeArtifact(artifacts, names.selection) &&
    (completionConclusion(jobs) !== 'success' || activeArtifact(artifacts, names.results))
  );
}

function runRecency(run) {
  const updated = Date.parse(run.updated_at ?? '');
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(run.created_at ?? '');
  return Number.isFinite(created) ? created : 0;
}

export function eligibleRun(run, jobs, artifacts, current) {
  return (
    matchesReadyRunContext(run, current) &&
    run.status === 'completed' &&
    run.conclusion === 'success' &&
    sourceRunKind(jobs) === 'ready' &&
    eligibleReadyJobs(jobs) &&
    eligibleReadyArtifacts(run, jobs, artifacts)
  );
}

export function validateCandidate(candidate, current) {
  const { run, jobs, artifacts } = candidate ?? {};
  if (
    !run ||
    !Array.isArray(jobs) ||
    !Array.isArray(artifacts) ||
    !eligibleRun(run, jobs, artifacts, current)
  )
    reject('Reusable source run is missing or no longer satisfies the ready-validation policy');
  return expectedArtifactNames(run);
}

// A newer applicable Ready attempt is authoritative, so its failure or missing evidence cannot fall back to an older pass.
export async function discoverReadyValidationCandidate(api, current) {
  validateCurrentEvent(current);
  const runs = await api.listRuns(current);
  const ordered = [...runs]
    .filter((run) => matchesReadyRunContext(run, current))
    .sort((a, b) => {
      const newest = runRecency(b) - runRecency(a);
      return (
        newest ||
        Number(b.run_attempt) - Number(a.run_attempt) ||
        String(b.id).localeCompare(String(a.id), undefined, { numeric: true })
      );
    });
  for (const run of ordered) {
    const jobs = await api.listJobs(run);
    const kind = sourceRunKind(jobs);
    if (kind === 'metadata' || kind === 'deferred') continue;
    if (kind !== 'ready')
      reject(
        'A newer E2E run has no completed Ready source classification; older evidence cannot be reused',
      );
    if (run.status !== 'completed' || run.conclusion !== 'success' || !eligibleReadyJobs(jobs))
      reject(
        'The newest Ready validation failed or is incomplete; older evidence cannot be reused',
      );
    const artifacts = await api.listArtifacts(run);
    if (!eligibleReadyArtifacts(run, jobs, artifacts))
      reject(
        'The newest Ready validation is missing active run-scoped evidence; older evidence cannot be reused',
      );
    return { run, jobs, artifacts: artifacts.map(({ name, expired }) => ({ name, expired })) };
  }
  reject('No successful Ready validation exists for this exact PR head and base');
}
