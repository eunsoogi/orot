import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REQUIRED_CI_JOBS,
  REQUIRED_CI_JOBS_BY_WORKFLOW,
  TRUSTED_CI_WORKFLOW_PATHS,
} from '../ci-required-jobs.mjs';

test('release gate mirrors all 22 required main branch-protection contexts', () => {
  const expected = {
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
      'E2E / Validate / Build',
      'E2E / Validate / UI',
      'E2E / Validate / Storage',
      'E2E / Validate / Provider',
      'E2E / Validate / Speech',
      'E2E / Validate / Questions',
    ],
  };

  assert.deepEqual(REQUIRED_CI_JOBS_BY_WORKFLOW, expected);
  assert.deepEqual(TRUSTED_CI_WORKFLOW_PATHS, Object.keys(expected));
  assert.deepEqual(REQUIRED_CI_JOBS, Object.values(expected).flat());
  assert.equal(REQUIRED_CI_JOBS.length, 22);
  assert.equal(new Set(REQUIRED_CI_JOBS).size, REQUIRED_CI_JOBS.length);
});
