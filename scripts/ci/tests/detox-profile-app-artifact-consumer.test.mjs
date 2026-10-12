// Keep cold artifact consumers separate from full DerivedData cache producers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { computeDetoxCacheFingerprints } from '../detox-cache-fingerprint.mjs';
import { readCocoapodsInputHashes } from '../detox-cocoapods-input-provenance.mjs';
import { runCacheCommand } from './fixtures/detox-derived-data-cache.mjs';
import {
  clean,
  consume,
  prepareFixture,
  produce,
} from './fixtures/detox-profile-app-artifact-fixture.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const cacheScript = join(repositoryRoot, 'scripts/ci/detox-derived-data-cache.mjs');
const profileWorkflow = readFileSync(
  join(repositoryRoot, '.github/workflows/detox-e2e-profile.yml'),
  'utf8',
);

function readOutputs(path) {
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function workflowStep(name) {
  const lines = profileWorkflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`      - name: ${name}`));
  assert.notEqual(start, -1, `Missing workflow step: ${name}`);
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith('      - name:')) end += 1;
  return lines.slice(start, end).join('\n');
}

const workflowConditions = {
  restoreFramework: workflowStep('Cache Detox framework outputs'),
  buildFramework: workflowStep('Build Detox iOS framework cache'),
  buildApp: workflowStep('Build Detox iOS Simulator app'),
  writeManifest: workflowStep('Write Detox DerivedData cache manifest'),
};

for (const profile of ['release', 'transcription']) {
  test(`${profile} artifact consumers prepare runtime outputs without compiling or publishing DerivedData`, async () => {
    const fixture = prepareFixture({ profile });
    try {
      const cocoapodsInputHashes = readCocoapodsInputHashes(fixture.repositoryRoot);
      const fingerprints = computeDetoxCacheFingerprints(fixture.repositoryRoot, {
        privacyManifestInputHash: cocoapodsInputHashes.privacyManifest,
        cocoapodsProjectInputHash: cocoapodsInputHashes.projectFile,
      });
      // Isolate GitHub's required provenance snapshot from the real runner's environment file.
      Object.assign(fixture.environment, {
        GITHUB_ENV: join(fixture.repositoryRoot, 'github-env.txt'),
        RUNNER_TEMP: join(fixture.repositoryRoot, 'runner-temp'),
        MACOS_VERSION: '27.0.1',
        EXPECTED_NODE_VERSION: '22.23.2',
        EXPECTED_PNPM_VERSION: '12.3.4',
        EXPECTED_RUBY_VERSION: '4.0.7',
        EXPECTED_COCOAPODS_VERSION: '1.17.0',
        EXPECTED_COCOAPODS_INPUT_HASHES_JSON: JSON.stringify(cocoapodsInputHashes),
        EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT: fingerprints.buildInputs,
        EXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT: fingerprints.nativeDependencies,
        OROT_DETOX_FRAMEWORK_CACHE_ROOT: join(fixture.repositoryRoot, 'detox-framework'),
      });
      mkdirSync(fixture.environment.RUNNER_TEMP, { recursive: true });
      const artifact = await produce(fixture);
      rmSync(join(fixture.repositoryRoot, 'apps/mobile/ios', `build-detox-${profile}`), {
        recursive: true,
        force: true,
      });
      rmSync(fixture.environment.OROT_DETOX_FRAMEWORK_CACHE_ROOT, {
        recursive: true,
        force: true,
      });

      runCacheCommand(fixture.repositoryRoot, 'prepare', profile, fixture.environment);
      const cache = readOutputs(fixture.outputPath);
      await consume(fixture, artifact, fixture.environment);
      const outputs = readOutputs(fixture.outputPath);
      const artifactAppReusable = outputs.profile_app_reusable === 'true';
      const combinedAppReusable = cache.app_reusable === 'true' || artifactAppReusable;

      assert.equal(cache.app_reusable, 'false');
      assert.equal(cache.detox_artifacts_reusable, 'false');
      assert.equal(artifactAppReusable, true);

      assert.throws(
        () =>
          execFileSync('node', [cacheScript, 'write', profile], {
            cwd: fixture.repositoryRoot,
            env: fixture.environment,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          }),
        (error) =>
          /Refusing to cache missing Detox framework outputs/.test(error.stderr.toString()),
      );
      assert.deepEqual(
        {
          restoreFrameworkForColdCache:
            /steps\.prepare_derived_data_cache\.outputs\.detox_artifacts_reusable != 'true'/.test(
              workflowConditions.restoreFramework,
            ),
          buildFrameworkForColdCache:
            /steps\.prepare_derived_data_cache\.outputs\.detox_artifacts_reusable != 'true'/.test(
              workflowConditions.buildFramework,
            ),
          skipAppBuildForArtifact:
            combinedAppReusable &&
            /steps\.prepare_derived_data_cache\.outputs\.app_reusable != 'true'/.test(
              workflowConditions.buildApp,
            ),
          skipManifestForArtifact:
            combinedAppReusable &&
            /steps\.prepare_derived_data_cache\.outputs\.app_reusable != 'true'/.test(
              workflowConditions.writeManifest,
            ),
        },
        {
          restoreFrameworkForColdCache: true,
          buildFrameworkForColdCache: true,
          skipAppBuildForArtifact: true,
          skipManifestForArtifact: true,
        },
      );
    } finally {
      clean(fixture);
    }
  });
}
