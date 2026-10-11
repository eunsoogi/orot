import { REQUIRED_CI_JOBS } from '../ci-required-jobs.mjs';

export const sourceSha = 'a'.repeat(40);

export function validContext(overrides = {}) {
  return {
    mode: 'publish',
    version: '0.1.0',
    applicationVersion: '0.1.0',
    tag: '0.1.0',
    ref: 'refs/heads/main',
    sha: sourceSha,
    sourceSha,
    currentMainSha: sourceSha,
    ciRun: {
      id: 1234,
      path: '.github/workflows/e2e-test.yml',
      event: 'push',
      head_branch: 'main',
      head_sha: sourceSha,
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://github.com/eunsoogi/orot/actions/runs/1234',
    },
    ciJobs: REQUIRED_CI_JOBS.map((name) => ({ name, status: 'completed', conclusion: 'success' })),
    previousTag: null,
    commits: [{ sha: sourceSha, subject: 'first release' }],
    tagTargetSha: null,
    release: null,
    ...overrides,
  };
}
