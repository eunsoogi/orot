import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { getProfile } from '../ios-derived-data-cache-paths.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const requireFromRepository = createRequire(join(repositoryRoot, 'package.json'));

function requireWithProfile(modulePath) {
  const previous = process.env.OROT_DETOX_TEST_PROFILE;
  process.env.OROT_DETOX_TEST_PROFILE = 'transcription';
  delete requireFromRepository.cache[requireFromRepository.resolve(modulePath)];
  try {
    return requireFromRepository(modulePath);
  } finally {
    delete requireFromRepository.cache[requireFromRepository.resolve(modulePath)];
    if (previous === undefined) delete process.env.OROT_DETOX_TEST_PROFILE;
    else process.env.OROT_DETOX_TEST_PROFILE = previous;
  }
}

function loadTranscriptionConfigWithCleanPathEnvironment() {
  const environment = { ...process.env };
  delete environment.OROT_SPEECH_TRANSCRIPTION_DERIVED_DATA_PATH;
  const configPath = join(repositoryRoot, 'apps/mobile/e2e/transcription.detox.config.js');
  const script = [
    `const config = require(${JSON.stringify(configPath)});`,
    "const app = config.apps['ios.speech-transcription'];",
    'process.stdout.write(JSON.stringify({ binaryPath: app.binaryPath, build: app.build }));',
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: join(repositoryRoot, 'apps/mobile'),
    encoding: 'utf8',
    env: environment,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Unable to load transcription Detox config.');
  }
  return JSON.parse(result.stdout);
}

test('routes only the dedicated transcription test and native configuration', () => {
  const detoxProfile = requireWithProfile('./scripts/ci/detox-e2e-profile.detox.config.cjs');
  const jestProfile = requireWithProfile('./scripts/ci/detox-e2e-profile.jest.config.cjs');
  const transcription = requireFromRepository('./apps/mobile/e2e/transcription.detox.config.js');
  const transcriptionJest = requireFromRepository('./apps/mobile/e2e/transcription.jest.config.js');

  assert.deepEqual(detoxProfile.configurations, transcription.configurations);
  assert.deepEqual(detoxProfile.apps, transcription.apps);
  assert.deepEqual(jestProfile.testMatch, transcriptionJest.testMatch);
  assert.deepEqual(jestProfile.testPathIgnorePatterns, []);
  assert.deepEqual(transcriptionJest.testMatch, ['<rootDir>/e2e/transcription.e2e.js']);
  assert.match(
    transcription.apps['ios.speech-transcription'].build,
    /OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST/,
  );
  assert.match(
    transcription.apps['ios.speech-transcription'].build,
    /ENTRY_FILE=e2e\/transcriptionProbeEntry\.tsx/,
  );
  assert.ok(
    transcription.apps['ios.speech-transcription'].build.includes(
      'ARCHS="$(uname -m)" ONLY_ACTIVE_ARCH=YES',
    ),
    'the transcription build must target the host architecture checked by the CI builder',
  );
  assert.notEqual(
    transcription.apps['ios.speech-transcription'].binaryPath,
    requireFromRepository('./apps/mobile/.detoxrc.js').apps['ios.release'].binaryPath,
  );
});

test('aligns clean-environment transcription build, cache, and Detox app paths', () => {
  const transcription = loadTranscriptionConfigWithCleanPathEnvironment();
  const profile = getProfile('transcription');
  const mobileRelativeCacheRoot = profile.derivedDataPath.replace(/^apps\/mobile\//, '');
  const builder = readFileSync(join(repositoryRoot, 'scripts/ci/build-detox-apps.sh'), 'utf8');
  const builderDefault = builder.match(
    /transcription_derived_data_path="\$\{OROT_SPEECH_TRANSCRIPTION_DERIVED_DATA_PATH:-([^}]+)\}"/,
  );

  assert.ok(builderDefault, 'the transcription builder must declare its default DerivedData root');
  assert.equal(builderDefault[1], mobileRelativeCacheRoot);
  assert.equal(transcription.binaryPath, `${mobileRelativeCacheRoot}/${profile.productPath}`);
  assert.ok(transcription.build.includes(`-derivedDataPath ${mobileRelativeCacheRoot}`));
});

test('connects a dedicated Simulator, native app cache, and required aggregate for the isolated profile', () => {
  const simulatorSetup = readFileSync(
    join(repositoryRoot, 'scripts/ci/prepare-detox-simulator.sh'),
    'utf8',
  );
  const builder = readFileSync(join(repositoryRoot, 'scripts/ci/build-detox-apps.sh'), 'utf8');
  const profilesWorkflow = readFileSync(
    join(repositoryRoot, '.github/workflows/detox-e2e-profiles.yml'),
    'utf8',
  );
  const profileWorkflow = readFileSync(
    join(repositoryRoot, '.github/workflows/detox-e2e-profile.yml'),
    'utf8',
  );

  assert.match(simulatorSetup, /OROT_SPEECH_TRANSCRIPTION_SIMULATOR_UDID/);
  assert.match(builder, /ios\.sim\.release\.transcription/);
  assert.match(profileWorkflow, /inputs\.profile == 'transcription'/);
  assert.match(profileWorkflow, /build-detox-\$\{\{ inputs\.profile \}\}\/Build\/Products/);
  assert.match(profilesWorkflow, /detox_transcription_e2e:[\s\S]*?profile: transcription/);
  assert.match(profilesWorkflow, /require-detox-transcription-aggregate\.mjs/);
});
