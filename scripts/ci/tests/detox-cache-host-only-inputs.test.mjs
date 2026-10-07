import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { computeDetoxCacheFingerprints } from '../detox-cache-fingerprint.mjs';
import { writeDetoxBuildConfigs } from './fixtures/detox-derived-data-cache.mjs';

function writeFixtureFile(root, path, content) {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

test('keeps Node-only transcription probe edits out of the app build fingerprint', () => {
  const root = mkdtempSync(join(tmpdir(), 'orot-detox-host-only-inputs-'));
  try {
    git(root, 'init', '-q');
    for (const path of [
      '.npmrc',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'apps/mobile/App.tsx',
      'apps/mobile/package.json',
      'apps/mobile/react-native.config.js',
      'apps/mobile/ios/Podfile.lock',
      'apps/mobile/ios/OrotMobile/PrivacyInfo.xcprivacy',
      'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj',
      'apps/mobile/e2e/transcription/transcriptEvidenceDetoxHelpers.js',
      'apps/mobile/src/transcription/__tests__/TranscriptEvidenceDetoxHelpers.spec.js',
      'packages/storage/src/index.ts',
      'scripts/ci/build-detox-apps.sh',
      'scripts/ci/build-ios-simulator-app.sh',
    ]) {
      writeFixtureFile(root, path, `initial:${path}`);
    }
    writeDetoxBuildConfigs(root);
    git(root, 'add', '--all');
    const initial = computeDetoxCacheFingerprints(root);

    for (const path of [
      'apps/mobile/e2e/transcription/transcriptEvidenceDetoxHelpers.js',
      'apps/mobile/src/transcription/__tests__/TranscriptEvidenceDetoxHelpers.spec.js',
    ]) {
      writeFixtureFile(root, path, `changed host-only code:${path}`);
    }
    git(root, 'add', '--all');

    assert.deepEqual(computeDetoxCacheFingerprints(root), initial);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
