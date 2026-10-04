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
      `build_inputs=${initial.buildInputs}\nreact_native_artifacts=${initial.reactNativeArtifacts}\n`,
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

    writeFixtureFile(root, 'apps/mobile/App.tsx', 'changed tracked app source');
    git(root, 'add', '--all');
    const afterAppSourceChange = computeDetoxCacheFingerprints(root);
    assert.notEqual(afterAppSourceChange.buildInputs, initial.buildInputs);
    assert.equal(afterAppSourceChange.reactNativeArtifacts, initial.reactNativeArtifacts);

    writeFixtureFile(root, 'apps/mobile/ios/Podfile.lock', 'changed CocoaPods lock');
    git(root, 'add', '--all');
    const afterLockChange = computeDetoxCacheFingerprints(root);
    assert.notEqual(afterLockChange.buildInputs, afterAppSourceChange.buildInputs);
    assert.notEqual(
      afterLockChange.reactNativeArtifacts,
      afterAppSourceChange.reactNativeArtifacts,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
