import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const runner = join(repositoryRoot, 'scripts/ci/run-test-suite.sh');

test('keeps Detox artifacts beneath the upload root across the mobile package cwd', () => {
  const artifactParent = join(repositoryRoot, 'artifacts');
  const createdArtifactParent = !existsSync(artifactParent);
  mkdirSync(artifactParent, { recursive: true });
  const artifactRoot = mkdtempSync(join(artifactParent, '.ci-detox-location-'));
  const artifactRelativePath = relative(repositoryRoot, artifactRoot);
  const tempDirectory = mkdtempSync(join(tmpdir(), 'orot-detox-location-'));
  const fakePnpm = join(tempDirectory, 'pnpm');
  const capturePath = join(tempDirectory, 'resolved-paths.txt');

  try {
    writeFileSync(fakePnpm, [
      '#!/usr/bin/env bash',
      'cd "$MOBILE_PACKAGE_DIRECTORY" || exit 93',
      'printf \'%s\\n%s\\n\' "$PWD" "$DETOX_ARTIFACTS_LOCATION" > "$DETOX_LOCATION_CAPTURE"',
      'mkdir -p "$DETOX_ARTIFACTS_LOCATION"',
      'printf \'retained failure artifact\\n\' > "$DETOX_ARTIFACTS_LOCATION/failure-artifact.txt"',
      'if [[ "$*" == *openai-provider* ]]; then',
      '  printf \'Test Suites: 1 passed, 1 total\\nTests: 1 passed, 1 total\\n\'',
      'else',
      '  printf \'Test Suites: 6 passed, 6 total\\nTests: 8 passed, 8 total\\n\'',
      'fi',
    ].join('\n'), { mode: 0o755 });

    const result = spawnSync('bash', [runner, 'e2e', artifactRelativePath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        DETOX_LOCATION_CAPTURE: capturePath,
        MOBILE_PACKAGE_DIRECTORY: join(repositoryRoot, 'apps/mobile'),
        OROT_DETOX_SIMULATOR_UDID: 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE',
        OROT_OPENAI_PROVIDER_SIMULATOR_UDID: 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE',
        PATH: [tempDirectory, process.env.PATH].join(':'),
      },
    });

    assert.equal(result.status, 0, result.stderr + result.stdout);
    const [packageDirectory, detoxArtifactDirectory] = readFileSync(capturePath, 'utf8').trim().split('\n');
    assert.equal(packageDirectory, join(repositoryRoot, 'apps/mobile'));
    assert.equal(detoxArtifactDirectory, join(artifactRoot, 'detox'));
    assert.equal(existsSync(join(artifactRoot, 'detox/failure-artifact.txt')), true);
    assert.equal(existsSync(join(repositoryRoot, 'apps/mobile', artifactRelativePath, 'detox/failure-artifact.txt')), false);
  } finally {
    rmSync(artifactRoot, { recursive: true, force: true });
    rmSync(join(repositoryRoot, 'apps/mobile', artifactRelativePath), { recursive: true, force: true });
    rmSync(tempDirectory, { recursive: true, force: true });
    if (createdArtifactParent && readdirSync(artifactParent).length === 0) rmdirSync(artifactParent);
  }
});
