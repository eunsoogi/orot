import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cacheScriptPath = fileURLToPath(new URL('../detox-derived-data-cache.mjs', import.meta.url));
const baseEnvironment = {
  DETOX_CACHE_RUNNER_OS: 'macOS',
  DETOX_CACHE_RUNNER_ARCH: 'ARM64',
  EXPECTED_MACOS_VERSION: '27.0',
  EXPECTED_NODE_VERSION: '22.23.2',
  EXPECTED_PNPM_VERSION: '12.3.4',
  EXPECTED_RUBY_VERSION: '4.0.7',
  EXPECTED_COCOAPODS_VERSION: '1.17.0',
  EXPECTED_XCODE_VERSION: '27.0',
  EXPECTED_IOS_SIMULATOR_SDK: '27.0',
};

function writeFixtureFile(root, path, content) {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

function runCacheCommand(root, command, profile = 'release', environment = {}) {
  return execFileSync('node', [cacheScriptPath, command, profile], {
    cwd: root,
    env: {
      ...process.env,
      ...baseEnvironment,
      GITHUB_ACTIONS: 'true',
      ...environment,
    },
    encoding: 'utf8',
  });
}

function createFixtureRepository() {
  const root = mkdtempSync(join(tmpdir(), 'orot-detox-derived-data-cache-'));
  git(root, 'init', '-q');
  for (const path of [
    '.github/workflows/ci.yml',
    '.github/workflows/detox-e2e-profile.yml',
    '.npmrc',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'apps/mobile/App.tsx',
    'apps/mobile/package.json',
    'apps/mobile/react-native.config.js',
    'apps/mobile/ios/Podfile',
    'apps/mobile/ios/Podfile.lock',
    'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj',
    'apps/mobile/e2e/release-e2e.test.js',
    'packages/storage/src/index.ts',
    'scripts/ci/build-detox-apps.sh',
    'scripts/ci/detox-cache-fingerprint.mjs',
    'scripts/ci/detox-derived-data-cache.mjs',
  ]) {
    writeFixtureFile(root, path, `fixture:${path}`);
  }
  writeFixtureFile(root, 'apps/mobile/package.json', '{"name":"@orot/mobile","type":"commonjs"}');
  writeFixtureFile(
    root,
    'apps/mobile/.detoxrc.js',
    `module.exports = {
      apps: { 'ios.release': { type: 'ios.app', binaryPath: 'ios/build/Orot.app', build: 'xcodebuild -derivedDataPath ios/build ENTRY_FILE=e2e/e2eRouterEntry.tsx' } },
      configurations: { 'ios.sim.release': { device: 'simulator', app: 'ios.release' } },
      devices: { simulator: { type: 'iPhone 18 Pro' } },
    };`,
  );
  writeFixtureFile(
    root,
    'apps/mobile/e2e/openai-provider.detox.config.js',
    `module.exports = {
      apps: { 'ios.openai-provider': { type: 'ios.app', binaryPath: 'ios/build-openai-provider/Orot.app', build: 'xcodebuild -derivedDataPath ios/build-openai-provider ENTRY_FILE=e2e/openaiProviderProbeEntry.tsx' } },
      configurations: { 'ios.sim.debug.openai-provider': { device: 'simulator', app: 'ios.openai-provider' } },
      devices: { simulator: { type: 'iPhone 18 Pro' } },
    };`,
  );
  git(root, 'add', '--all');
  return root;
}

test('reuses exact caches and clears only app outputs for dependency-compatible input changes', () => {
  const root = createFixtureRepository();
  const derivedData = join(root, 'apps/mobile/ios/build');
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
    mkdirSync(derivedData, { recursive: true });
    runCacheCommand(root, 'write');
    writeFixtureFile(
      root,
      'apps/mobile/ios/build/Build/Intermediates.noindex/OrotMobile.build/Release-iphonesimulator/stale.o',
      'app',
    );
    writeFixtureFile(
      root,
      'apps/mobile/ios/build/Build/Products/Release-iphonesimulator/Orot.app/stale.txt',
      'app',
    );
    writeFixtureFile(
      root,
      'apps/mobile/ios/build/Build/Intermediates.noindex/Pods.build/Release-iphonesimulator/pod.o',
      'pod',
    );
    writeFixtureFile(
      root,
      'apps/mobile/ios/build/Build/Products/Release-iphonesimulator/FixturePod.framework/Pod',
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

    runCacheCommand(root, 'write');
    writeFixtureFile(
      root,
      'apps/mobile/ios/build/Build/Intermediates.noindex/Pods.build/Release-iphonesimulator/pod.o',
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

    const debugData = join(root, 'apps/mobile/ios/build-openai-provider');
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
  const derivedData = join(root, 'apps/mobile/ios/build');
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
      'apps/mobile/ios/build/Build/Intermediates.noindex/OrotMobile.build/Release-iphonesimulator/stale.o',
      'app',
    );
    writeFixtureFile(root, 'external/Orot.app/stale.txt', 'preserve');
    mkdirSync(dirname(appProduct), { recursive: true });
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
