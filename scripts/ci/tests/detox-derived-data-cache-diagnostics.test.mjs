import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { computeDetoxCacheFingerprints } from '../detox-cache-fingerprint.mjs';

const cacheScriptPath = fileURLToPath(new URL('../detox-derived-data-cache.mjs', import.meta.url));
const workflowPath = fileURLToPath(
  new URL('../../../.github/workflows/detox-e2e-profile.yml', import.meta.url),
);
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

function createFixtureRepository() {
  const root = mkdtempSync(join(tmpdir(), 'orot-detox-cache-diagnostics-'));
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
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
  execFileSync('git', ['add', '--all'], { cwd: root, stdio: 'ignore' });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=CI fixture',
      '-c',
      'user.email=ci-fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '--message',
      'fixture',
    ],
    { cwd: root, stdio: 'ignore' },
  );
  return root;
}

function runCacheCommand(root, command, environment = {}) {
  return execFileSync('node', [cacheScriptPath, command, 'release'], {
    cwd: root,
    env: { ...process.env, ...baseEnvironment, GITHUB_ACTIONS: 'true', ...environment },
    encoding: 'utf8',
  });
}

test('records the invalidation diagnostic and passes prebuild hashes to manifest writing', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  assert.match(
    workflow,
    /DERIVED_DATA_CACHE_DIAGNOSTIC: \$\{\{ steps\.prepare_derived_data_cache\.outputs\.derived_data_cache_diagnostic \}\}/,
  );
  assert.match(
    workflow,
    /EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT: \$\{\{ steps\.detox_cache_fingerprint\.outputs\.build_inputs \}\}/,
  );
  assert.match(
    workflow,
    /EXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT: \$\{\{ steps\.detox_cache_fingerprint\.outputs\.native_dependencies \}\}/,
  );
  assert.match(
    workflow,
    /node scripts\/ci\/detox-derived-data-cache\.mjs write .*\| tee -a artifacts\/detox\/native-cache\.log/,
  );
});

test('reports the static mismatch field and hashes before invalidating an incompatible cache', () => {
  const root = createFixtureRepository();
  const derivedData = join(root, 'apps/mobile/ios/build');
  const manifestPath = join(derivedData, '.orot-detox-cache.json');
  const outputPath = join(root, 'prepare-output.txt');

  try {
    mkdirSync(derivedData, { recursive: true });
    runCacheCommand(root, 'write');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.toolchain.xcodeVersion = 'private-value-must-not-be-logged';
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const output = runCacheCommand(root, 'prepare', { GITHUB_OUTPUT: outputPath });
    assert.match(output, /classification=invalidated/);
    assert.match(output, /reason=manifest_incompatible/);
    assert.match(output, /mismatch_fields=toolchain\.xcodeVersion/);
    assert.match(output, /cached_toolchain_sha256=[a-f0-9]{64}/);
    assert.match(output, /expected_toolchain_sha256=[a-f0-9]{64}/);
    assert.doesNotMatch(output, /private-value-must-not-be-logged/);
    assert.match(
      readFileSync(outputPath, 'utf8'),
      /derived_data_cache_reason=manifest_incompatible/,
    );
    assert.equal(existsSync(derivedData), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps unknown toolchain manifest keys out of diagnostic and GitHub output fields', () => {
  const root = createFixtureRepository();
  const derivedData = join(root, 'apps/mobile/ios/build');
  const manifestPath = join(derivedData, '.orot-detox-cache.json');
  const outputPath = join(root, 'prepare-output.txt');

  try {
    mkdirSync(derivedData, { recursive: true });
    runCacheCommand(root, 'write');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.toolchain['unknown\nforged_output=sentinel_marker'] = 'untrusted-value';
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const output = runCacheCommand(root, 'prepare', { GITHUB_OUTPUT: outputPath });
    const githubOutput = readFileSync(outputPath, 'utf8');
    assert.match(output, /mismatch_fields=toolchain\.unknown_fields/);
    assert.match(githubOutput, /derived_data_cache_mismatch_fields=toolchain\.unknown_fields/);
    assert.doesNotMatch(output, /forged_output|sentinel_marker/);
    assert.doesNotMatch(githubOutput, /forged_output|sentinel_marker/);
    assert.equal(existsSync(derivedData), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses to write a cache manifest when build fingerprints drift after the build', () => {
  const root = createFixtureRepository();
  const derivedData = join(root, 'apps/mobile/ios/build');
  const manifestPath = join(derivedData, '.orot-detox-cache.json');
  const outputPath = join(root, 'write-output.txt');

  try {
    mkdirSync(derivedData, { recursive: true });
    const beforeBuild = computeDetoxCacheFingerprints(root);
    writeFixtureFile(root, 'apps/mobile/ios/Podfile.lock', 'changed after the build fingerprint');
    execFileSync('git', ['add', '--all'], { cwd: root, stdio: 'ignore' });

    assert.throws(
      () =>
        runCacheCommand(root, 'write', {
          EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT: beforeBuild.buildInputs,
          EXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT: beforeBuild.nativeDependencies,
          GITHUB_OUTPUT: outputPath,
        }),
      (error) => /prebuild_fingerprint_mismatch/.test(error.stderr.toString()),
    );
    const output = readFileSync(outputPath, 'utf8');
    assert.match(output, /manifest_fingerprint_match=false/);
    assert.match(output, /manifest_build_inputs=[a-f0-9]{64}/);
    assert.match(output, /manifest_native_dependencies=[a-f0-9]{64}/);
    assert.equal(existsSync(manifestPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('names changed tracked build inputs when refusing a drifted cache manifest', () => {
  const root = createFixtureRepository();
  const derivedData = join(root, 'apps/mobile/ios/build');

  try {
    mkdirSync(derivedData, { recursive: true });
    const beforeBuild = computeDetoxCacheFingerprints(root);
    writeFixtureFile(root, 'apps/mobile/ios/Podfile.lock', 'changed during the build');
    const injectedPath = 'apps/mobile/ios/unexpected\nforged_output=sentinel';
    writeFixtureFile(root, injectedPath, 'untrusted path');
    execFileSync('git', ['add', '--all'], { cwd: root, stdio: 'ignore' });

    assert.throws(
      () =>
        runCacheCommand(root, 'write', {
          EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT: beforeBuild.buildInputs,
          EXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT: beforeBuild.nativeDependencies,
        }),
      (error) => {
        const output = error.stdout.toString();
        const diagnostic = output
          .split('\n')
          .find((line) => line.includes('tracked_build_input_changes='));
        const prefix = 'tracked_build_input_changes=';
        const reportedPaths = JSON.parse(
          diagnostic.slice(diagnostic.indexOf(prefix) + prefix.length),
        );
        assert.deepEqual(reportedPaths, ['apps/mobile/ios/Podfile.lock', injectedPath].sort());
        assert.doesNotMatch(output, /\nforged_output=sentinel/);
        return /prebuild_fingerprint_mismatch/.test(error.stderr.toString());
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
