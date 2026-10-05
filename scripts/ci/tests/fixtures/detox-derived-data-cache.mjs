import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cacheScriptPath = fileURLToPath(
  new URL('../../detox-derived-data-cache.mjs', import.meta.url),
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

export function writeFixtureFile(root, path, content) {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

export function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

export function runCacheCommand(root, command, profile = 'release', environment = {}) {
  return execFileSync('node', [cacheScriptPath, command, profile], {
    cwd: root,
    env: { ...process.env, ...baseEnvironment, GITHUB_ACTIONS: 'true', ...environment },
    encoding: 'utf8',
  });
}

export function createFixtureRepository() {
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
    'scripts/ci/detox-cache-fingerprint-cli.mjs',
    'scripts/ci/detox-derived-data-cache.mjs',
  ]) {
    writeFixtureFile(root, path, `fixture:${path}`);
  }
  writeFixtureFile(root, 'apps/mobile/package.json', '{"name":"@orot/mobile","type":"commonjs"}');
  writeFixtureFile(
    root,
    'apps/mobile/ios/build/generated/ios/ReactCodegen/ReactCodegen.xcconfig',
    'PODS_TARGET_SRCROOT=$(SRCROOT)/build/generated/ios/ReactCodegen',
  );
  writeFixtureFile(
    root,
    'apps/mobile/.detoxrc.js',
    `module.exports = {
      apps: { 'ios.release': { type: 'ios.app', binaryPath: 'ios/build-detox-release/Orot.app', build: 'xcodebuild -derivedDataPath ios/build-detox-release ENTRY_FILE=e2e/e2eRouterEntry.tsx' } },
      configurations: { 'ios.sim.release': { device: 'simulator', app: 'ios.release' } },
      devices: { simulator: { type: 'iPhone 18 Pro' } },
    };`,
  );
  writeFixtureFile(
    root,
    'apps/mobile/e2e/openai-provider.detox.config.js',
    `module.exports = {
      apps: { 'ios.openai-provider': { type: 'ios.app', binaryPath: 'ios/build-detox-openai-provider/Orot.app', build: 'xcodebuild -derivedDataPath ios/build-detox-openai-provider ENTRY_FILE=e2e/openaiProviderProbeEntry.tsx' } },
      configurations: { 'ios.sim.debug.openai-provider': { device: 'simulator', app: 'ios.openai-provider' } },
      devices: { simulator: { type: 'iPhone 18 Pro' } },
    };`,
  );
  git(root, 'add', '--all');
  return root;
}
