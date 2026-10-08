import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { getProfile } from '../ios-derived-data-cache-paths.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const requireFromRepository = createRequire(join(repositoryRoot, 'package.json'));

function requireWithNextVisitProfile(modulePath) {
  const previous = process.env.OROT_DETOX_TEST_PROFILE;
  process.env.OROT_DETOX_TEST_PROFILE = 'next-visit-questions';
  delete requireFromRepository.cache[requireFromRepository.resolve(modulePath)];
  try {
    return requireFromRepository(modulePath);
  } finally {
    delete requireFromRepository.cache[requireFromRepository.resolve(modulePath)];
    if (previous === undefined) delete process.env.OROT_DETOX_TEST_PROFILE;
    else process.env.OROT_DETOX_TEST_PROFILE = previous;
  }
}

test('routes the deterministic screen entry through its isolated app and Jest profiles', () => {
  const cacheProfile = getProfile('next-visit-questions');
  const detoxProfile = requireWithNextVisitProfile(
    './scripts/ci/detox-e2e-profile.detox.config.cjs',
  );
  const jestProfile = requireWithNextVisitProfile('./scripts/ci/detox-e2e-profile.jest.config.cjs');
  const probe = requireFromRepository('./apps/mobile/e2e/next-visit-questions.detox.config.js');
  const probeJest = requireFromRepository('./apps/mobile/e2e/next-visit-questions.jest.config.js');

  assert.equal(cacheProfile.derivedDataPath, 'apps/mobile/ios/build-detox-next-visit-questions');
  assert.equal(cacheProfile.configuration, 'Debug-iphonesimulator');
  assert.deepEqual(detoxProfile.configurations, probe.configurations);
  assert.deepEqual(detoxProfile.apps, probe.apps);
  assert.match(
    probe.apps['ios.next-visit-questions'].build,
    /ENTRY_FILE=e2e\/nextVisitQuestionsProbeEntry\.tsx/,
  );
  assert.deepEqual(jestProfile.testMatch, probeJest.testMatch);
  assert.deepEqual(probeJest.testMatch, ['<rootDir>/e2e/next-visit-questions.e2e.js']);
});

test('runs the synthetic E2E profile from a focused PR workflow', () => {
  const workflow = readFileSync(
    join(repositoryRoot, '.github/workflows/next-visit-questions-e2e.yml'),
    'utf8',
  );
  const genericProfiles = readFileSync(
    join(repositoryRoot, '.github/workflows/detox-e2e-profiles.yml'),
    'utf8',
  );
  const reusableProfile = readFileSync(
    join(repositoryRoot, '.github/workflows/detox-e2e-profile.yml'),
    'utf8',
  );
  const suiteRunner = readFileSync(join(repositoryRoot, 'scripts/ci/run-test-suite.sh'), 'utf8');

  assert.match(workflow, /pull_request:[\s\S]*paths:/);
  assert.match(workflow, /apps\/mobile\/src\/nextVisitQuestions\/\*\*/);
  assert.match(workflow, /apps\/mobile\/e2e\/next-visit-questions\*/);
  assert.match(workflow, /apps\/mobile\/e2e\/nextVisitQuestionsProbeEntry\.tsx/);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/detox-e2e-profile\.yml/);
  assert.match(workflow, /profile: next-visit-questions/);
  assert.match(reusableProfile, /inputs\.profile == 'next-visit-questions'/);
  assert.match(suiteRunner, /e2e-next-visit-questions/);
  assert.doesNotMatch(genericProfiles, /next-visit-questions/);
});
