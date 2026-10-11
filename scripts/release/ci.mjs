import { collectPaginatedItems } from './version-tags.mjs';

const RUN_PAGE_SIZE = 100;
const FULL_SHA = /^[0-9a-f]{40}$/i;

export function listWorkflowRunsForSourcePushes(repo, sourceSha, readJson) {
  const runs = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = readJson(
      `repos/${repo}/actions/runs?head_sha=${sourceSha}&branch=main&event=push&per_page=${RUN_PAGE_SIZE}&page=${page}`,
    );
    const pageRuns = Array.isArray(response.workflow_runs) ? response.workflow_runs : null;
    if (!pageRuns) throw new Error('GitHub returned an invalid workflow run list');
    runs.push(...pageRuns);

    const total = Number(response.total_count);
    if (Number.isSafeInteger(total) && runs.length >= total) return runs;
    if (pageRuns.length < RUN_PAGE_SIZE) {
      if (Number.isSafeInteger(total) && runs.length < total)
        throw new Error('GitHub returned an incomplete workflow run list for the source commit');
      return runs;
    }
  }
  throw new Error('GitHub workflow run listing exceeded the supported 1,000-run limit');
}

function runOrder(left, right) {
  const leftTime = Date.parse(left.run_started_at ?? left.created_at ?? '') || 0;
  const rightTime = Date.parse(right.run_started_at ?? right.created_at ?? '') || 0;
  return (
    leftTime - rightTime ||
    Number(left.run_number ?? 0) - Number(right.run_number ?? 0) ||
    Number(left.id ?? 0) - Number(right.id ?? 0)
  );
}

// Protected checks span independent workflows; use each workflow's newest run for this exact commit.
export function latestMainPushRuns(sourceSha, workflowRuns) {
  if (!FULL_SHA.test(sourceSha ?? '')) throw new Error('source commit SHA is invalid');
  const selected = new Map();
  for (const run of workflowRuns) {
    if (
      run.event !== 'push' ||
      run.head_branch !== 'main' ||
      run.head_sha?.toLowerCase() !== sourceSha.toLowerCase() ||
      typeof run.path !== 'string'
    ) {
      continue;
    }
    const current = selected.get(run.path);
    if (!current || runOrder(run, current) > 0) selected.set(run.path, run);
  }
  return [...selected.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function collectJobsForMainPushes(sourceSha, workflowRuns, readJobs) {
  return latestMainPushRuns(sourceSha, workflowRuns).flatMap((run) => {
    const jobs = readJobs(run.id);
    if (!Array.isArray(jobs))
      throw new Error(`GitHub returned invalid jobs for workflow run ${run.id}`);
    return jobs.map((job) => ({ ...job, workflow_path: run.path, workflow_run_id: run.id }));
  });
}

export function readWorkflowRunJobs(repo, runId, readJson) {
  return collectPaginatedItems(
    (page) => {
      const response = readJson(
        `repos/${repo}/actions/runs/${runId}/jobs?per_page=${RUN_PAGE_SIZE}&page=${page}`,
      );
      if (!Array.isArray(response.jobs))
        throw new Error(`GitHub returned invalid jobs for workflow run ${runId}`);
      return response.jobs;
    },
    { pageSize: RUN_PAGE_SIZE, maxPages: 20 },
  );
}
