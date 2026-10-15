// Keep every protected check tied to the workflow path that is allowed to prove it.
export const REQUIRED_CI_JOBS_BY_WORKFLOW = {
  '.github/workflows/code-quality.yml': [
    'Maintained file inventory',
    'Lint / JavaScript',
    'Lint / TypeScript',
    'Lint / Swift',
    'Lint / Objective-C',
    'Lint / Shell',
    'Lint / Ruby',
    'Lint / YAML',
    'Lint / JSON',
    'Lint / XML',
    'Lint / Properties',
    'Source LOC policy',
    'Format check',
  ],
  '.github/workflows/unit-test.yml': ['TypeScript typecheck', 'Unit and component tests'],
  '.github/workflows/policy-check.yml': ['CI, release, and quality gate tests'],
  '.github/workflows/e2e-test.yml': [
    'Validate / Build',
    'Validate / UI',
    'Validate / Storage',
    'Validate / Provider',
    'Validate / Speech',
    'Validate / Questions',
  ],
};

export const TRUSTED_CI_WORKFLOW_PATHS = Object.keys(REQUIRED_CI_JOBS_BY_WORKFLOW);

// Full iOS evidence comes from automatic main pushes. Selected diagnostics never attest release readiness.
export function isAcceptedCiWorkflowEvent(path, event) {
  if (!TRUSTED_CI_WORKFLOW_PATHS.includes(path)) return false;
  return (
    event === 'push' || (event === 'workflow_dispatch' && path !== '.github/workflows/e2e-test.yml')
  );
}

export const REQUIRED_CI_JOBS = Object.values(REQUIRED_CI_JOBS_BY_WORKFLOW).flat();
export const REQUIRED_CI_JOB_WORKFLOW_PATH = Object.fromEntries(
  Object.entries(REQUIRED_CI_JOBS_BY_WORKFLOW).flatMap(([path, jobs]) =>
    jobs.map((name) => [name, path]),
  ),
);
