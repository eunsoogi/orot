import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { computeDetoxCacheFingerprints } from '../detox-cache-fingerprint.mjs';
import { computeDetoxCocoapodsCacheFingerprint } from '../detox-cocoapods-cache-fingerprint.mjs';
import { writeDetoxBuildConfigs } from './fixtures/detox-derived-data-cache.mjs';

function writeFixtureFile(root, path, content) {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

test('reuses CocoaPods inputs across app source edits but invalidates native metadata and locks', () => {
  const root = mkdtempSync(join(tmpdir(), 'orot-detox-cocoapods-cache-'));
  try {
    git(root, 'init', '-q');
    const files = {
      '.npmrc': 'shared config',
      'package.json': '{"name":"root"}',
      'pnpm-lock.yaml': 'lock: 1',
      'pnpm-workspace.yaml': 'packages: [apps/*, packages/*]',
      'apps/mobile/package.json': '{"op-sqlite":{"fts5":false}}',
      'apps/mobile/react-native.config.js': 'module.exports = {};',
      'apps/mobile/App.tsx': 'export default function App() {}',
      'apps/mobile/ios/Podfile': 'platform :ios, "17.0"',
      'apps/mobile/ios/Podfile.lock':
        'PODS:\n  - op-sqlite\nSPEC CHECKSUMS:\n  op-sqlite: 5c8147c2d5ecb4e0bcf8f7f2d45d04f3413459a7\n',
      'apps/mobile/ios/OrotMobile/AppDelegate.swift': 'final class AppDelegate {}',
      'apps/mobile/ios/OrotMobile/PrivacyInfo.xcprivacy': '<plist/>',
      'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj': 'project',
      'packages/provider-openai/package.json': '{"name":"@orot/provider-openai"}',
      'packages/provider-openai/react-native.config.js': 'module.exports = {};',
      'packages/provider-openai/orot-provider.podspec': 'Pod::Spec.new do |s| end',
      'packages/provider-openai/Sources/OpenAIProvider/ResponsesEventNormalizer.swift':
        'struct ResponsesEventNormalizer { let requestID: String }',
      'scripts/ci/build-detox-apps.sh': 'build pods and app',
      'scripts/ci/build-ios-simulator-app.sh': 'build simulator app',
    };
    for (const [path, content] of Object.entries(files)) writeFixtureFile(root, path, content);
    writeDetoxBuildConfigs(root);
    git(root, 'add', '--all');

    const podsBefore = computeDetoxCocoapodsCacheFingerprint(root);
    const appBefore = computeDetoxCacheFingerprints(root);
    writeFixtureFile(
      root,
      'apps/mobile/ios/OrotMobile/AppDelegate.swift',
      'final class AppDelegate { var updated = true }',
    );
    git(root, 'add', '--all');
    const podsAfterAppSourceEdit = computeDetoxCocoapodsCacheFingerprint(root);
    const appAfterAppSourceEdit = computeDetoxCacheFingerprints(root);
    assert.equal(podsAfterAppSourceEdit, podsBefore);
    assert.notEqual(appAfterAppSourceEdit.buildInputs, appBefore.buildInputs);
    assert.notEqual(appAfterAppSourceEdit.nativeDependencies, appBefore.nativeDependencies);

    writeFixtureFile(
      root,
      'packages/provider-openai/Sources/OpenAIProvider/ResponsesEventNormalizer.swift',
      'struct ResponsesEventNormalizer { let requestID: String; var events = [String]() }',
    );
    git(root, 'add', '--all');
    const podsAfterSourceEdit = computeDetoxCocoapodsCacheFingerprint(root);
    const appAfterSourceEdit = computeDetoxCacheFingerprints(root);
    assert.equal(podsAfterSourceEdit, podsAfterAppSourceEdit);
    assert.notEqual(appAfterSourceEdit.buildInputs, appAfterAppSourceEdit.buildInputs);
    assert.notEqual(
      appAfterSourceEdit.nativeDependencies,
      appAfterAppSourceEdit.nativeDependencies,
    );

    writeFixtureFile(root, 'apps/mobile/package.json', '{"op-sqlite":{"fts5":true}}');
    git(root, 'add', '--all');
    const podsAfterFts5Change = computeDetoxCocoapodsCacheFingerprint(root);
    const appAfterFts5Change = computeDetoxCacheFingerprints(root);
    assert.notEqual(podsAfterFts5Change, podsAfterSourceEdit);
    assert.notEqual(appAfterFts5Change.buildInputs, appAfterSourceEdit.buildInputs);
    assert.notEqual(appAfterFts5Change.nativeDependencies, appAfterSourceEdit.nativeDependencies);

    writeFixtureFile(
      root,
      'apps/mobile/ios/Podfile.lock',
      'PODS:\n  - op-sqlite\nSPEC CHECKSUMS:\n  op-sqlite: 9e8a3d41e315c96450481f1ba70e6e69c285fa3e\n',
    );
    git(root, 'add', '--all');
    const podsAfterLockChange = computeDetoxCocoapodsCacheFingerprint(root);
    const appAfterLockChange = computeDetoxCacheFingerprints(root);
    assert.notEqual(podsAfterLockChange, podsAfterFts5Change);
    assert.notEqual(appAfterLockChange.buildInputs, appAfterFts5Change.buildInputs);
    assert.notEqual(appAfterLockChange.nativeDependencies, appAfterFts5Change.nativeDependencies);
    assert.notEqual(
      appAfterLockChange.reactNativeArtifacts,
      appAfterFts5Change.reactNativeArtifacts,
    );

    writeFixtureFile(
      root,
      'packages/provider-openai/package.json',
      '{"name":"@orot/provider-openai","codegenConfig":{"name":"OpenAI"}}',
    );
    git(root, 'add', '--all');
    const podsAfterPackageConfigChange = computeDetoxCocoapodsCacheFingerprint(root);
    assert.notEqual(podsAfterPackageConfigChange, podsAfterLockChange);

    writeFixtureFile(
      root,
      'packages/provider-openai/react-native.config.js',
      'module.exports = { dependency: { platforms: { ios: null } } };',
    );
    git(root, 'add', '--all');
    const podsAfterAutolinkingChange = computeDetoxCocoapodsCacheFingerprint(root);
    assert.notEqual(podsAfterAutolinkingChange, podsAfterPackageConfigChange);

    writeFixtureFile(root, 'packages/provider-openai/orot-provider.podspec', 'updated podspec');
    git(root, 'add', '--all');
    const podsAfterPodspecChange = computeDetoxCocoapodsCacheFingerprint(root);
    assert.notEqual(podsAfterPodspecChange, podsAfterAutolinkingChange);

    writeFixtureFile(
      root,
      'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj',
      'project with CocoaPods integration',
    );
    git(root, 'add', '--all');
    const podsAfterProjectChange = computeDetoxCocoapodsCacheFingerprint(root);
    assert.notEqual(podsAfterProjectChange, podsAfterPodspecChange);

    writeFixtureFile(
      root,
      'apps/mobile/ios/OrotMobile/PrivacyInfo.xcprivacy',
      '<plist><array><string>NSPrivacyAccessedAPICategoryFileTimestamp</string></array></plist>',
    );
    git(root, 'add', '--all');
    assert.notEqual(computeDetoxCocoapodsCacheFingerprint(root), podsAfterProjectChange);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
