import { REQUIRED_CI_JOBS, REQUIRED_CI_JOBS_BY_WORKFLOW } from '../ci-required-jobs.mjs';

export const sourceSha = 'a'.repeat(40);
const jobWorkflowPath = Object.fromEntries(
  Object.entries(REQUIRED_CI_JOBS_BY_WORKFLOW).flatMap(([path, jobs]) =>
    jobs.map((name) => [name, path]),
  ),
);

export function validContext(overrides = {}) {
  const ciRuns = Object.keys(REQUIRED_CI_JOBS_BY_WORKFLOW).map((path, index) => ({
    id: 1234 + index,
    path,
    event: path === '.github/workflows/e2e-test.yml' ? 'workflow_dispatch' : 'push',
    head_branch: 'main',
    head_sha: sourceSha,
    status: 'completed',
    conclusion: 'success',
    html_url: `https://github.com/eunsoogi/orot/actions/runs/${1234 + index}`,
  }));
  const runIdByPath = Object.fromEntries(ciRuns.map(({ id, path }) => [path, id]));
  return {
    mode: 'publish',
    version: '0.1.0',
    applicationVersion: '0.1.0',
    tag: '0.1.0',
    ref: 'refs/heads/main',
    sha: sourceSha,
    sourceSha,
    currentMainSha: sourceSha,
    ciRuns,
    ciJobs: REQUIRED_CI_JOBS.map((name) => ({
      name,
      workflow_path: jobWorkflowPath[name],
      workflow_run_id: runIdByPath[jobWorkflowPath[name]],
      status: 'completed',
      conclusion: 'success',
    })),
    previousTag: null,
    commits: [{ sha: sourceSha, subject: 'first release' }],
    tagTargetSha: null,
    release: null,
    ...overrides,
  };
}
