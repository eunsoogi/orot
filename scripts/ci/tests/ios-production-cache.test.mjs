import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { computeIosCacheFingerprints } from '../ios-cache-fingerprint.mjs';
import {
  createFixtureRepository,
  git,
  runCacheCommand,
  writeFixtureFile,
} from './fixtures/ios-derived-data-cache.mjs';

// Synthetic repositories and Apple-tool stubs characterize cache policy; this is not a native build observation.
function withFixture(name, run) {
  test(name, () => {
    const root = createFixtureRepository();
    try {
      run(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
const dataPath = (root) => join(root, 'apps/mobile/ios/build-production');
const generatedPath = (root) =>
  join(root, 'apps/mobile/ios/build/generated/ios/ReactCodegen/ReactCodegen.xcconfig');

withFixture(
  'exact production reuse has no obsolete framework or configuration dependency',
  (root) => {
    assert.match(runCacheCommand(root, 'prepare'), /classification=miss/);
    runCacheCommand(root, 'write');
    const output = runCacheCommand(root, 'prepare');
    assert.match(output, /classification=exact/);
    assert.match(output, /app_reusable=true/);
    assert.equal(existsSync(join(root, 'ios-framework')), false);
    assert.equal(existsSync(join(root, 'apps/mobile/.iosrc.js')), false);
  },
);

withFixture(
  'JS changes clear only the production app while preserving Pods and Codegen',
  (root) => {
    runCacheCommand(root, 'write');
    writeFixtureFile(
      root,
      'apps/mobile/ios/build-production/Build/Intermediates.noindex/Pods.build/Debug-iphonesimulator/pod.o',
      'pod',
    );
    writeFixtureFile(root, 'apps/mobile/App.tsx', 'changed app JS');
    git(root, 'add', '--all');
    assert.match(runCacheCommand(root, 'prepare'), /classification=dependency-compatible/);
    assert.equal(
      existsSync(join(dataPath(root), 'Build/Products/Debug-iphonesimulator/Orot.app')),
      false,
    );
    assert.equal(
      readFileSync(
        join(dataPath(root), 'Build/Intermediates.noindex/Pods.build/Debug-iphonesimulator/pod.o'),
        'utf8',
      ),
      'pod',
    );
    assert.ok(existsSync(generatedPath(root)));
  },
);

withFixture(
  'native dependency and production recipe changes invalidate only the owned root',
  (root) => {
    runCacheCommand(root, 'write');
    writeFixtureFile(root, 'apps/mobile/ios/Podfile.lock', 'changed native dependency');
    assert.throws(
      () =>
        runCacheCommand(root, 'prepare', 'production', {
          GITHUB_ACTIONS: 'false',
        }),
      /limited to GitHub Actions/,
    );
    assert.ok(existsSync(dataPath(root)));
    assert.match(runCacheCommand(root, 'prepare'), /classification=invalidated/);
    assert.equal(existsSync(dataPath(root)), false);
    assert.ok(existsSync(generatedPath(root)));
    runCacheCommand(root, 'write');
    writeFixtureFile(root, 'scripts/ci/build-ios-simulator-app.sh', 'changed production flags');
    assert.match(runCacheCommand(root, 'prepare'), /classification=invalidated/);
  },
);

withFixture('tampered app bytes and observed toolchain changes cannot reuse the app', (root) => {
  runCacheCommand(root, 'write');
  writeFileSync(
    join(dataPath(root), 'Build/Products/Debug-iphonesimulator/Orot.app/Info.plist'),
    'wrong-bundle-id',
  );
  assert.match(runCacheCommand(root, 'prepare'), /app_reusable=false/);
  runCacheCommand(root, 'write');
  assert.match(
    runCacheCommand(root, 'prepare', 'production', {
      MACOS_VERSION: '27.0.2',
    }),
    /classification=invalidated/,
  );
  assert.throws(
    () => runCacheCommand(root, 'prepare', 'production', { MACOS_VERSION: '' }),
    /Missing Ios cache toolchain values/,
  );
});

withFixture(
  'pre-Pods source hashes and post-install digests retain their original drift boundary',
  (root) => {
    const initial = computeIosCacheFingerprints(root);
    const runnerTemp = join(root, 'runner-temp');
    mkdirSync(runnerTemp);
    const env = {
      RUNNER_TEMP: runnerTemp,
      EXPECTED_COCOAPODS_INPUT_HASHES_JSON: JSON.stringify({
        privacyManifest: initial.privacyManifestInputHash,
        projectFile: initial.cocoapodsProjectInputHash,
      }),
      EXPECTED_IOS_BUILD_INPUT_FINGERPRINT: initial.buildInputs,
      EXPECTED_IOS_NATIVE_DEPENDENCY_FINGERPRINT: initial.nativeDependencies,
    };
    runCacheCommand(root, 'prepare', env);
    writeFixtureFile(
      root,
      'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj',
      'generated project',
    );
    writeFixtureFile(root, 'apps/mobile/ios/OrotMobile/PrivacyInfo.xcprivacy', 'generated privacy');
    assert.match(runCacheCommand(root, 'verify-build-inputs', env), /post-pods-verified/);
    runCacheCommand(root, 'write', env);
    const manifest = JSON.parse(readFileSync(join(dataPath(root), '.orot-ios-cache.json')));
    assert.equal(manifest.schemaVersion, 7);
    assert.notEqual(
      manifest.cocoapodsInputProvenance.baseline.projectFile,
      manifest.cocoapodsInputProvenance.afterInstall.projectFile,
    );
    writeFixtureFile(root, 'apps/mobile/App.tsx', 'unexpected source mutation');
    assert.throws(
      () => runCacheCommand(root, 'write', env),
      /fingerprint_mismatch|unexpected build-input changes/,
    );
  },
);

withFixture(
  'symlinked production roots and obsolete profiles are rejected before cleanup',
  (root) => {
    const outside = join(root, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'sentinel'), 'preserve');
    symlinkSync(outside, dataPath(root));
    assert.throws(() => runCacheCommand(root, 'prepare'), /symbolic link/);
    assert.equal(readFileSync(join(outside, 'sentinel'), 'utf8'), 'preserve');
    assert.throws(() => runCacheCommand(root, 'prepare', 'release'), /Usage:/);
  },
);
