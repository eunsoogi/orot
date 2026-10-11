import assert from 'node:assert/strict';
import test from 'node:test';
import { REQUIRED_CI_JOBS } from '../ci-required-jobs.mjs';

test('release gate mirrors all 22 required main branch-protection contexts', () => {
  assert.deepEqual(REQUIRED_CI_JOBS, [
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
    'TypeScript typecheck',
    'Unit and component tests',
    'CI, release, and quality gate tests',
    'iOS Simulator Build',
    'Detox E2E profiles / Release shards / Release UI and storage / Detox release iOS E2E',
    'Detox E2E profiles / Release shards / Release stateful-data / Detox release iOS E2E',
    'Detox E2E profiles / OpenAI Debug E2E / Detox openai-provider iOS E2E',
    'Detox E2E profiles / Speech Transcription E2E / Detox transcription iOS E2E',
    'Detox E2E profiles / Next Visit Questions E2E / Detox next-visit-questions iOS E2E',
  ]);
  assert.equal(new Set(REQUIRED_CI_JOBS).size, REQUIRED_CI_JOBS.length);
});
