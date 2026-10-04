import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { computeDetoxCacheFingerprints } from '../detox-cache-fingerprint.mjs';

const fingerprintScriptPath = fileURLToPath(
  new URL('../detox-cache-fingerprint.mjs', import.meta.url),
);

function writeFixtureFile(root, path, content) {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function writeDetoxBuildConfigs(root) {
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
      apps: { 'ios.openai-provider': { type: 'ios.app', binaryPath: 'ios/build-openai-provider/Orot.app', build: 'xcodebuild -derivedDataPath ios/build-openai-provider' } },
      configurations: { 'ios.sim.debug.openai-provider': { device: 'simulator', app: 'ios.openai-provider' } },
      devices: { simulator: { type: 'iPhone 18 Pro' } },
    };`,
  );
}

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

test('keeps the cache fingerprint stable for tracked build inputs and ignores generated outputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'orot-detox-cache-fingerprint-'));
  try {
    git(root, 'init', '-q');
    for (const path of [
      '.github/workflows/ci.yml',
      '.github/workflows/detox-e2e-profile.yml',
      '.npmrc',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'apps/mobile/App.tsx',
      'apps/mobile/ios/Podfile.lock',
      'packages/storage/src/index.ts',
      'scripts/ci/build-detox-apps.sh',
      'scripts/ci/detox-cache-fingerprint.mjs',
      'scripts/ci/detox-derived-data-cache.mjs',
      'scripts/ci/run-detox-e2e.sh',
      'scripts/ci/detox-e2e-profile.detox.config.cjs',
      'scripts/ci/detox-e2e-profile.jest.config.cjs',
      'apps/mobile/ios/build/DerivedData.db',
      'apps/mobile/ios/build-openai-provider/DerivedData.db',
      'apps/mobile/ios/build-agent-memory/DerivedData.db',
      'apps/mobile/ios/Pods/Pods.xcodeproj/project.pbxproj',
      'apps/mobile/node_modules/generated.js',
      'packages/storage/node_modules/generated.js',
      'apps/mobile/.cache/generated.js',
      'apps/mobile/ios/CoreSimulator/devices/generated.plist',
      'apps/mobile/ios/Simulator/devices/generated.plist',
      'apps/mobile/ios/Keychains/login.keychain',
    ]) {
      writeFixtureFile(root, path, `initial:${path}`);
    }
    writeDetoxBuildConfigs(root);
    git(root, 'add', '--all');

    const initial = computeDetoxCacheFingerprints(root);
    const outputPath = join(root, 'github-output.txt');
    execFileSync('node', [fingerprintScriptPath], {
      cwd: root,
      env: { ...process.env, GITHUB_OUTPUT: outputPath },
      encoding: 'utf8',
    });
    assert.equal(
      readFileSync(outputPath, 'utf8'),
      `build_inputs=${initial.buildInputs}\nreact_native_artifacts=${initial.reactNativeArtifacts}\nnative_dependencies=${initial.nativeDependencies}\n`,
    );

    writeFixtureFile(root, 'apps/mobile/ios/build/DerivedData.db', 'changed Release build output');
    writeFixtureFile(
      root,
      'apps/mobile/ios/build-openai-provider/DerivedData.db',
      'changed Debug build output',
    );
    writeFixtureFile(
      root,
      'apps/mobile/ios/build-agent-memory/DerivedData.db',
      'changed feature build output',
    );
    writeFixtureFile(
      root,
      'apps/mobile/ios/Pods/Pods.xcodeproj/project.pbxproj',
      'changed Pods output',
    );
    writeFixtureFile(root, 'apps/mobile/node_modules/generated.js', 'changed app dependency');
    writeFixtureFile(
      root,
      'packages/storage/node_modules/generated.js',
      'changed package dependency',
    );
    writeFixtureFile(root, 'apps/mobile/.cache/generated.js', 'changed cache output');
    writeFixtureFile(
      root,
      'apps/mobile/ios/CoreSimulator/devices/generated.plist',
      'changed Simulator output',
    );
    writeFixtureFile(
      root,
      'apps/mobile/ios/Simulator/devices/generated.plist',
      'changed Simulator output',
    );
    writeFixtureFile(root, 'apps/mobile/ios/Keychains/login.keychain', 'changed Keychain output');
    git(root, 'add', '--all');
    const afterGeneratedOutputs = computeDetoxCacheFingerprints(root);

    assert.deepEqual(afterGeneratedOutputs, initial);

    writeFixtureFile(root, 'scripts/ci/run-detox-e2e.sh', 'changed Detox invocation wrapper');
    writeFixtureFile(
      root,
      'scripts/ci/detox-e2e-profile.detox.config.cjs',
      'changed Detox test-runner config',
    );
    writeFixtureFile(
      root,
      'scripts/ci/detox-e2e-profile.jest.config.cjs',
      'changed Jest-only profile config',
    );
    git(root, 'add', '--all');
    const afterTestRunnerConfigChanges = computeDetoxCacheFingerprints(root);

    assert.deepEqual(afterTestRunnerConfigChanges, initial);

    writeFixtureFile(
      root,
      '.github/workflows/detox-e2e-profile.yml',
      'changed workflow-only build orchestration',
    );
    git(root, 'add', '--all');
    const afterWorkflowChange = computeDetoxCacheFingerprints(root);
    assert.notEqual(afterWorkflowChange.buildInputs, initial.buildInputs);
    assert.equal(afterWorkflowChange.nativeDependencies, initial.nativeDependencies);

    writeFixtureFile(
      root,
      'apps/mobile/.detoxrc.js',
      `// formatting-only change\n${readFileSync(join(root, 'apps/mobile/.detoxrc.js'), 'utf8')}`,
    );
    git(root, 'add', '--all');
    const afterDetoxConfigFormattingChange = computeDetoxCacheFingerprints(root);
    assert.notEqual(afterDetoxConfigFormattingChange.buildInputs, initial.buildInputs);
    assert.equal(afterDetoxConfigFormattingChange.nativeDependencies, initial.nativeDependencies);

    writeFixtureFile(
      root,
      'apps/mobile/.detoxrc.js',
      readFileSync(join(root, 'apps/mobile/.detoxrc.js'), 'utf8').replace(
        'ENTRY_FILE=e2e/e2eRouterEntry.tsx',
        'ENTRY_FILE=e2e/checkpointProbeEntry.tsx',
      ),
    );
    git(root, 'add', '--all');
    const afterJavaScriptEntryChange = computeDetoxCacheFingerprints(root);
    assert.notEqual(afterJavaScriptEntryChange.buildInputs, initial.buildInputs);
    assert.equal(afterJavaScriptEntryChange.nativeDependencies, initial.nativeDependencies);

    writeFixtureFile(root, 'apps/mobile/App.tsx', 'changed tracked app source');
    git(root, 'add', '--all');
    const afterAppSourceChange = computeDetoxCacheFingerprints(root);
    assert.notEqual(afterAppSourceChange.buildInputs, initial.buildInputs);
    assert.equal(afterAppSourceChange.reactNativeArtifacts, initial.reactNativeArtifacts);
    assert.equal(afterAppSourceChange.nativeDependencies, initial.nativeDependencies);

    writeFixtureFile(
      root,
      'apps/mobile/.detoxrc.js',
      readFileSync(join(root, 'apps/mobile/.detoxrc.js'), 'utf8').replace(
        '-derivedDataPath ios/build',
        '-derivedDataPath ios/build-v2',
      ),
    );
    git(root, 'add', '--all');
    const afterBuildConfigurationChange = computeDetoxCacheFingerprints(root);
    assert.notEqual(afterBuildConfigurationChange.nativeDependencies, initial.nativeDependencies);

    writeFixtureFile(root, 'apps/mobile/ios/Podfile.lock', 'changed CocoaPods lock');
    git(root, 'add', '--all');
    const afterLockChange = computeDetoxCacheFingerprints(root);
    assert.notEqual(afterLockChange.buildInputs, afterAppSourceChange.buildInputs);
    assert.notEqual(
      afterLockChange.reactNativeArtifacts,
      afterAppSourceChange.reactNativeArtifacts,
    );
    assert.notEqual(
      afterLockChange.nativeDependencies,
      afterBuildConfigurationChange.nativeDependencies,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
