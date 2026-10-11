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
    'iOS Simulator Build',
    'Detox E2E profiles / Release shards / Release UI and storage / Detox release iOS E2E',
    'Detox E2E profiles / Release shards / Release stateful-data / Detox release iOS E2E',
    'Detox E2E profiles / OpenAI Debug E2E / Detox openai-provider iOS E2E',
    'Detox E2E profiles / Speech Transcription E2E / Detox transcription iOS E2E',
    'Detox E2E profiles / Next Visit Questions E2E / Detox next-visit-questions iOS E2E',
  ],
};

export const TRUSTED_CI_WORKFLOW_PATHS = Object.keys(REQUIRED_CI_JOBS_BY_WORKFLOW);
export const ACCEPTED_CI_WORKFLOW_EVENTS = ['push', 'workflow_dispatch'];
export const REQUIRED_CI_JOBS = Object.values(REQUIRED_CI_JOBS_BY_WORKFLOW).flat();
export const REQUIRED_CI_JOB_WORKFLOW_PATH = Object.fromEntries(
  Object.entries(REQUIRED_CI_JOBS_BY_WORKFLOW).flatMap(([path, jobs]) =>
    jobs.map((name) => [name, path]),
  ),
);
