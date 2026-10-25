import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Keep the historical Xcode configuration warnings covered without invoking Xcode in CI.
test('production simulator build passes Xcode a generic destination', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-generic-simulator-destination-'));
  const capture = join(directory, 'arguments.txt');
  const executable = join(directory, 'xcodebuild');
  writeFileSync(executable, '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$OROT_XCODE_ARGUMENTS"\n');
  chmodSync(executable, 0o755);
  const environment = {
    ...process.env,
    PATH: `${directory}:${process.env.PATH}`,
    OROT_XCODE_ARGUMENTS: capture,
  };
  delete environment.GITHUB_ACTIONS;

  try {
    const result = spawnSync('bash', ['scripts/ci/build-ios-simulator-app.sh', 'build'], {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: environment,
    });
    assert.equal(result.status, 0, result.stderr);
    const capturedArguments = readFileSync(capture, 'utf8').trim().split('\n');
    assert.equal(
      capturedArguments[capturedArguments.indexOf('-destination') + 1],
      'generic/platform=iOS Simulator',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('app Info.plist omits the empty unused location usage description', () => {
  const info = readFileSync(resolve('apps/mobile/ios/OrotMobile/Info.plist'), 'utf8');
  assert.doesNotMatch(info, /<key>NSLocationWhenInUseUsageDescription<\/key>/);
});

test('shared test scheme uses dependency-ordered buildables', () => {
  const scheme = readFileSync(
    resolve('apps/mobile/ios/OrotMobile.xcodeproj/xcshareddata/xcschemes/OrotTests.xcscheme'),
    'utf8',
  );
  assert.match(scheme, /parallelizeBuildables\s*=\s*"YES"/);
  assert.match(scheme, /buildImplicitDependencies\s*=\s*"YES"/);
});
