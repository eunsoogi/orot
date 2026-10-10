import assert from 'node:assert/strict';
import test from 'node:test';
import { REQUIRED_CI_JOBS } from '../ci-required-jobs.mjs';

test('requires every direct quality and E2E leaf check without aggregate wrappers', () => {
  // Keep the release check set aligned with the actual leaf names used by branch protection.
  const lintSurfaces = [
    'JavaScript',
    'TypeScript',
    'Swift',
    'Objective-C',
    'Shell',
    'Ruby',
    'YAML',
    'JSON',
    'XML',
    'Properties',
  ];
  for (const surface of lintSurfaces) {
    assert.ok(REQUIRED_CI_JOBS.includes(`Linux code checks / Lint / ${surface}`));
  }
  for (const name of [
    'Linux code checks / Maintained file inventory',
    'Linux code checks / Source LOC policy',
    'Linux code checks / Format check',
    'Linux test checks / TypeScript typecheck',
    'Linux test checks / Unit and component tests',
    'Linux test checks / CI, release, and quality gate tests',
    'iOS Simulator Build',
    'Detox E2E profiles / Release shards / Release UI and storage / Detox release iOS E2E',
    'Detox E2E profiles / Release shards / Release stateful-data / Detox release iOS E2E',
    'Detox E2E profiles / OpenAI Debug E2E / Detox openai-provider iOS E2E',
    'Detox E2E profiles / Speech Transcription E2E / Detox transcription iOS E2E',
    'Detox E2E profiles / Next Visit Questions E2E / Detox next-visit-questions iOS E2E',
  ]) {
    assert.ok(REQUIRED_CI_JOBS.includes(name), `release policy omits ${name}`);
  }
  assert.equal(new Set(REQUIRED_CI_JOBS).size, REQUIRED_CI_JOBS.length);
  assert.doesNotMatch(REQUIRED_CI_JOBS.join('\n'), /Quality Linux|Detox iOS E2E|Require complete/);
});
