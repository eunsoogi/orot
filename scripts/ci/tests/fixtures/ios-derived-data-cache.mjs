import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cacheScriptPath = fileURLToPath(new URL('../../ios-derived-data-cache.mjs', import.meta.url));
const baseEnvironment = {
  IOS_CACHE_RUNNER_OS: 'macOS',
  IOS_CACHE_RUNNER_ARCH: 'ARM64',
  MACOS_VERSION: '27.0',
  EXPECTED_NODE_VERSION: '22.23.2',
  EXPECTED_PNPM_VERSION: '12.3.4',
  EXPECTED_RUBY_VERSION: '4.0.7',
  EXPECTED_COCOAPODS_VERSION: '1.17.0',
  EXPECTED_XCODE_VERSION: '27.1',
  XCODEBUILD_FINGERPRINT: 'a'.repeat(64),
  EXPECTED_IOS_SIMULATOR_SDK: '27.1',
};

export function writeFixtureFile(root, path, content) {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

export function writeIosBuildConfigs(root) {
  writeFixtureFile(
    root,
    'scripts/ci/build-ios-simulator-app.sh',
    'xcodebuild default production recipe',
  );
}

export function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

export function runCacheCommand(root, command, profile = 'production', environment = {}) {
  if (typeof profile !== 'string') {
    environment = profile;
    profile = 'production';
  }
  if (command === 'write') writeAppFixture(root, profile);
  return execFileSync('node', [cacheScriptPath, command, profile], {
    cwd: root,
    env: {
      ...process.env,
      ...baseEnvironment,
      GITHUB_ACTIONS: 'true',
      GITHUB_ENV: '',
      PATH: join(root, 'bin') + ':' + (environment.PATH ?? process.env.PATH),
      ...environment,
    },
    encoding: 'utf8',
  });
}

function writeAppFixture(root, profile) {
  if (profile !== 'production') throw new Error('Fixture only covers production');
  const buildFolder = 'build-production';
  const configuration = 'Debug-iphonesimulator';
  const product = join(
    root,
    'apps/mobile/ios',
    buildFolder,
    'Build/Products',
    configuration,
    'Orot.app',
  );
  writeFixtureFile(
    root,
    join('apps/mobile/ios', buildFolder, 'Build/Products', configuration, 'Orot.app/Orot'),
    'valid-architecture',
  );
  writeFixtureFile(
    root,
    join('apps/mobile/ios', buildFolder, 'Build/Products', configuration, 'Orot.app/Info.plist'),
    'valid-plist',
  );
  if (profile !== 'production') {
    writeFixtureFile(
      root,
      join(
        'apps/mobile/ios',
        buildFolder,
        'Build/Products',
        configuration,
        'Orot.app/main.jsbundle',
      ),
      'valid-js-bundle',
    );
  }
  mkdirSync(product, { recursive: true });
}

function installIosAppTools(root) {
  const architecture = process.arch === 'x64' ? 'x86_64' : process.arch;
  const xcrunPath = join(root, 'bin/xcrun');
  const plutilPath = join(root, 'bin/plutil');
  writeFixtureFile(
    root,
    'bin/xcrun',
    `#!/bin/sh\n[ "$1:$2" = "lipo:-archs" ] || exit 2\n[ "$(cat "$3")" = valid-architecture ] || exit 1\nprintf '%s\\n' '${architecture}'\n`,
  );
  // Keep the fake Apple metadata reader POSIX so fixture-based cache tests also run on Linux.
  writeFixtureFile(
    root,
    'bin/plutil',
    `#!/bin/sh\nplist=$(cat "$6")\ncase "$2" in\n  CFBundleIdentifier)\n    case "$plist" in\n      wrong-bundle-id) echo com.invalid ;;\n      valid-plist) echo com.orot.mobile ;;\n      *) exit 1 ;;\n    esac\n    ;;\n  CFBundleExecutable) [ "$plist" = valid-plist ] && echo Orot ;;\n  CFBundlePackageType) [ "$plist" = valid-plist ] && echo APPL ;;\n  CFBundleSupportedPlatforms) [ "$plist" = valid-plist ] && printf '%s\\n' '["iPhoneSimulator"]' ;;\n  *) exit 2 ;;\nesac\n`,
  );
  chmodSync(xcrunPath, 0o755);
  chmodSync(plutilPath, 0o755);
}

export function createFixtureRepository() {
  const root = mkdtempSync(join(tmpdir(), 'orot-ios-derived-data-cache-'));
  git(root, 'init', '-q');
  for (const path of [
    '.github/workflows/e2e-test.yml',
    '.github/workflows/ios-e2e-profile.yml',
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
    'apps/mobile/ios/OrotMobile/PrivacyInfo.xcprivacy',
    'apps/mobile/e2e/release-e2e.test.js',
    'apps/mobile/e2e/smoke.test.js',
    'apps/mobile/e2e/calendar.ios.e2e.js',
    'apps/mobile/e2e/e2eRouterEntry.tsx',
    'packages/storage/src/index.ts',
    'scripts/ci/build-ios-simulator-app.sh',
    'scripts/ci/ios-cache-fingerprint.mjs',
    'scripts/ci/ios-cache-fingerprint-cli.mjs',
    'scripts/ci/ios-derived-data-cache.mjs',
  ]) {
    writeFixtureFile(root, path, `fixture:${path}`);
  }
  writeFixtureFile(root, 'apps/mobile/package.json', '{"name":"@orot/mobile","type":"commonjs"}');
  writeFixtureFile(
    root,
    'apps/mobile/ios/build/generated/ios/ReactCodegen/ReactCodegen.xcconfig',
    'PODS_TARGET_SRCROOT=$(SRCROOT)/build/generated/ios/ReactCodegen',
  );
  writeIosBuildConfigs(root);
  installIosAppTools(root);
  git(root, 'add', '--all');
  git(
    root,
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
  );
  return root;
}
