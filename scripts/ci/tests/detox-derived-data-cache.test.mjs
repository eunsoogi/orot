import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  createFixtureRepository,
  git,
  runCacheCommand,
  writeFixtureFile,
} from './fixtures/detox-derived-data-cache.mjs';

function assertPodsCodegenPreserved(path) {
  assert.equal(
    readFileSync(path, 'utf8'),
    'PODS_TARGET_SRCROOT=$(SRCROOT)/build/generated/ios/ReactCodegen',
  );
}

test('reuses exact caches and clears only app outputs for dependency-compatible input changes', () => {
  const root = createFixtureRepository();
  const derivedData = join(root, 'apps/mobile/ios/build-detox-release');
  const podsCodegenOutput = join(
    root,
    'apps/mobile/ios/build/generated/ios/ReactCodegen/ReactCodegen.xcconfig',
  );
  const appTarget = join(
    derivedData,
    'Build/Intermediates.noindex/OrotMobile.build/Release-iphonesimulator',
  );
  const appProduct = join(derivedData, 'Build/Products/Release-iphonesimulator/Orot.app');
  const podsTarget = join(
    derivedData,
    'Build/Intermediates.noindex/Pods.build/Release-iphonesimulator',
  );
  const podsProduct = join(
    derivedData,
    'Build/Products/Release-iphonesimulator/FixturePod.framework',
  );

  try {
    assert.match(runCacheCommand(root, 'prepare'), /classification=miss/);
    assertPodsCodegenPreserved(podsCodegenOutput);
    mkdirSync(derivedData, { recursive: true });
    runCacheCommand(root, 'write');
    writeFixtureFile(
      root,
      'apps/mobile/ios/build-detox-release/Build/Intermediates.noindex/OrotMobile.build/Release-iphonesimulator/stale.o',
      'app',
    );
    writeFixtureFile(
      root,
      'apps/mobile/ios/build-detox-release/Build/Products/Release-iphonesimulator/Orot.app/stale.txt',
      'app',
    );
    writeFixtureFile(
      root,
      'apps/mobile/ios/build-detox-release/Build/Intermediates.noindex/Pods.build/Release-iphonesimulator/pod.o',
      'pod',
    );
    writeFixtureFile(
      root,
      'apps/mobile/ios/build-detox-release/Build/Products/Release-iphonesimulator/FixturePod.framework/Pod',
      'pod',
    );

    assert.match(runCacheCommand(root, 'prepare'), /classification=exact/);
    assert.ok(existsSync(join(appTarget, 'stale.o')));
    assert.ok(existsSync(join(appProduct, 'stale.txt')));

    writeFixtureFile(root, 'apps/mobile/App.tsx', 'changed JavaScript source');
    git(root, 'add', '--all');
    assert.match(runCacheCommand(root, 'prepare'), /classification=dependency-compatible/);
    assert.equal(existsSync(appTarget), false);
    assert.equal(existsSync(appProduct), false);
    assert.equal(readFileSync(join(podsTarget, 'pod.o'), 'utf8'), 'pod');
    assert.equal(readFileSync(join(podsProduct, 'Pod'), 'utf8'), 'pod');
    assertPodsCodegenPreserved(podsCodegenOutput);

    runCacheCommand(root, 'write');
    writeFixtureFile(
      root,
      'apps/mobile/ios/build-detox-release/Build/Intermediates.noindex/Pods.build/Release-iphonesimulator/pod.o',
      'pod',
    );
    writeFixtureFile(root, 'apps/mobile/ios/Podfile.lock', 'changed native dependency');
    git(root, 'add', '--all');

    assert.throws(
      () => runCacheCommand(root, 'prepare', 'release', { GITHUB_ACTIONS: 'false' }),
      (error) => /limited to GitHub Actions/.test(error.stderr.toString()),
    );
    assert.ok(existsSync(join(podsTarget, 'pod.o')));

    assert.match(runCacheCommand(root, 'prepare'), /classification=invalidated/);
    assert.equal(existsSync(derivedData), false);
    assertPodsCodegenPreserved(podsCodegenOutput);

    const debugData = join(root, 'apps/mobile/ios/build-detox-openai-provider');
    const debugTarget = join(
      debugData,
      'Build/Intermediates.noindex/OrotMobile.build/Debug-iphonesimulator',
    );
    const debugProduct = join(debugData, 'Build/Products/Debug-iphonesimulator/Orot.app');
    const debugPodsTarget = join(
      debugData,
      'Build/Intermediates.noindex/Pods.build/Debug-iphonesimulator',
    );
    mkdirSync(debugTarget, { recursive: true });
    mkdirSync(debugProduct, { recursive: true });
    mkdirSync(debugPodsTarget, { recursive: true });
    runCacheCommand(root, 'write', 'openai-provider');
    writeFileSync(join(debugTarget, 'stale.o'), 'app');
    writeFileSync(join(debugProduct, 'stale.txt'), 'app');
    writeFileSync(join(debugPodsTarget, 'pod.o'), 'pod');
    writeFixtureFile(
      root,
      'apps/mobile/e2e/openai-provider.detox.config.js',
      readFileSync(join(root, 'apps/mobile/e2e/openai-provider.detox.config.js'), 'utf8').replace(
        'ENTRY_FILE=e2e/openaiProviderProbeEntry.tsx',
        'ENTRY_FILE=e2e/openaiProviderRegressionEntry.tsx',
      ),
    );
    git(root, 'add', '--all');
    assert.match(
      runCacheCommand(root, 'prepare', 'openai-provider'),
      /classification=dependency-compatible/,
    );
    assert.equal(existsSync(debugTarget), false);
    assert.equal(existsSync(debugProduct), false);
    assert.equal(readFileSync(join(debugPodsTarget, 'pod.o'), 'utf8'), 'pod');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses to follow symlinks restored inside a compatible cache', () => {
  const root = createFixtureRepository();
  const derivedData = join(root, 'apps/mobile/ios/build-detox-release');
  const appTarget = join(
    derivedData,
    'Build/Intermediates.noindex/OrotMobile.build/Release-iphonesimulator',
  );
  const appProduct = join(derivedData, 'Build/Products/Release-iphonesimulator/Orot.app');
  const externalProduct = join(root, 'external/Orot.app');

  try {
    mkdirSync(derivedData, { recursive: true });
    runCacheCommand(root, 'write');
    writeFixtureFile(
      root,
      'apps/mobile/ios/build-detox-release/Build/Intermediates.noindex/OrotMobile.build/Release-iphonesimulator/stale.o',
      'app',
    );
    writeFixtureFile(root, 'external/Orot.app/stale.txt', 'preserve');
    mkdirSync(dirname(appProduct), { recursive: true });
    rmSync(appProduct, { recursive: true, force: true });
    symlinkSync(externalProduct, appProduct, 'dir');
    writeFixtureFile(root, 'apps/mobile/App.tsx', 'changed JavaScript source');
    git(root, 'add', '--all');

    assert.throws(
      () => runCacheCommand(root, 'prepare'),
      (error) => /symbolic link/.test(error.stderr.toString()),
    );
    assert.equal(readFileSync(join(externalProduct, 'stale.txt'), 'utf8'), 'preserve');
    assert.equal(existsSync(join(appTarget, 'stale.o')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a dangling DerivedData root symlink instead of treating it as a cache miss', () => {
  const root = createFixtureRepository();
  const derivedData = join(root, 'apps/mobile/ios/build-detox-release');
  const danglingTarget = join(root, 'outside/cache-target');

  try {
    symlinkSync(danglingTarget, derivedData, 'dir');
    assert.throws(
      () => runCacheCommand(root, 'prepare'),
      (error) => /symbolic link/.test(error.stderr.toString()),
    );
    assert.equal(existsSync(danglingTarget), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
