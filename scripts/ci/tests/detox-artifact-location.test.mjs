import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { installDetoxHostSamplerStubs } from './detox-host-sampling-stubs.mjs';

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
      '  printf \'Test Suites: 1 passed, 1 total\\nTests: 8 passed, 8 total\\n\'',
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

test('publishes Release results with failure-only logs and no resource sample by default', () => {
  const artifactParent = join(repositoryRoot, 'artifacts');
  const createdArtifactParent = !existsSync(artifactParent);
  mkdirSync(artifactParent, { recursive: true });
  const artifactRoot = mkdtempSync(join(artifactParent, '.ci-detox-release-'));
  const artifactRelativePath = relative(repositoryRoot, artifactRoot);
  const tempDirectory = mkdtempSync(join(tmpdir(), 'orot-detox-release-'));
  const fakePnpm = join(tempDirectory, 'pnpm');
  const summaryOutput = join(tempDirectory, 'github-output');
  const envCapture = join(tempDirectory, 'detox-env.txt');
  const resourceCapture = join(tempDirectory, 'resource-path.txt');
  const commandCapture = join(tempDirectory, 'detox-command.txt');
  const simulatorId = 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE';

  try {
    writeFileSync(fakePnpm, [
      '#!/usr/bin/env bash',
      'cd "$MOBILE_PACKAGE_DIRECTORY" || exit 93',
      'printf \'%s\\n%s\\n\' "$DETOX_RECORD_LOGS" "${OROT_DETOX_TEST_LOG_LEVEL:-info}" > "$DETOX_ENV_CAPTURE"',
      'printf \'%s\\n\' "${OROT_DETOX_RESOURCE_LOG_PATH:-}" > "$RESOURCE_CAPTURE"',
      'printf \'%s\\n\' "$*" > "$DETOX_COMMAND_CAPTURE"',
      'printf \'Test Suites: 1 passed, 1 total\\nTests: 8 passed, 8 total\\n\'',
      'mkdir -p "$DETOX_ARTIFACTS_LOCATION/release"',
  ].join('\n'), { mode: 0o755 });
    const result = spawnSync('bash', [runner, 'e2e-release', artifactRelativePath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: summaryOutput,
        DETOX_ENV_CAPTURE: envCapture,
        RESOURCE_CAPTURE: resourceCapture,
        DETOX_COMMAND_CAPTURE: commandCapture,
        MOBILE_PACKAGE_DIRECTORY: join(repositoryRoot, 'apps/mobile'),
        OROT_DETOX_SIMULATOR_UDID: simulatorId,
        OROT_OPENAI_PROVIDER_SIMULATOR_UDID: '',
        OROT_DETOX_RESOURCE_SAMPLING: '',
        PATH: [tempDirectory, process.env.PATH].join(':'),
      },
    });

    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(readFileSync(summaryOutput, 'utf8'), 'e2e_profile=release\ne2e_test_cases=8\ne2e_test_suites=1\n');
    assert.equal(readFileSync(envCapture, 'utf8'), 'failing\ninfo\n');
    assert.equal(readFileSync(resourceCapture, 'utf8'), '\n');
    assert.match(readFileSync(commandCapture, 'utf8'), /--artifacts-location .*\/detox\/release/);
    assert.equal(existsSync(join(artifactRoot, 'e2e-test.log')), true);
    assert.equal(existsSync(join(artifactRoot, 'detox-resource-samples.log')), false);
    assert.equal(existsSync(join(artifactRoot, 'detox/release/success.log')), false);
  } finally {
    rmSync(artifactRoot, { recursive: true, force: true });
    rmSync(join(repositoryRoot, 'apps/mobile', artifactRelativePath), { recursive: true, force: true });
    rmSync(tempDirectory, { recursive: true, force: true });
    if (createdArtifactParent && readdirSync(artifactParent).length === 0) rmdirSync(artifactParent);
  }
});

test('allows bounded profile sampling only when explicitly requested', () => {
  const artifactParent = join(repositoryRoot, 'artifacts');
  const createdArtifactParent = !existsSync(artifactParent);
  mkdirSync(artifactParent, { recursive: true });
  const artifactRoot = mkdtempSync(join(artifactParent, '.ci-detox-resource-opt-in-'));
  const artifactRelativePath = relative(repositoryRoot, artifactRoot);
  const tempDirectory = mkdtempSync(join(tmpdir(), 'orot-detox-resource-opt-in-'));
  const fakePnpm = join(tempDirectory, 'pnpm');
  const envCapture = join(tempDirectory, 'detox-env.txt');
  const resourceCapture = join(tempDirectory, 'resource-path.txt');
  const samplerCallsPath = join(tempDirectory, 'sampler-calls.log');
  const simulatorId = 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE';

  try {
    writeFileSync(fakePnpm, [
      '#!/usr/bin/env bash',
      'cd "$MOBILE_PACKAGE_DIRECTORY" || exit 93',
      'printf \'%s\\n%s\\n\' "$DETOX_RECORD_LOGS" "${OROT_DETOX_TEST_LOG_LEVEL:-info}" > "$DETOX_ENV_CAPTURE"',
      'printf \'%s\\n\' "${OROT_DETOX_RESOURCE_LOG_PATH:-}" > "$RESOURCE_CAPTURE"',
      'printf \'Test Suites: 1 passed, 1 total\\nTests: 8 passed, 8 total\\n\'',
    ].join('\n'), { mode: 0o755 });
    installDetoxHostSamplerStubs(tempDirectory);

    const result = spawnSync('bash', [runner, 'e2e-release', artifactRelativePath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        DETOX_ENV_CAPTURE: envCapture,
        RESOURCE_CAPTURE: resourceCapture,
        DETOX_SAMPLER_CALLS: samplerCallsPath,
        MOBILE_PACKAGE_DIRECTORY: join(repositoryRoot, 'apps/mobile'),
        OROT_DETOX_SIMULATOR_UDID: simulatorId,
        OROT_OPENAI_PROVIDER_SIMULATOR_UDID: '',
        OROT_DETOX_RESOURCE_SAMPLING: 'true',
        PATH: [tempDirectory, process.env.PATH].join(':'),
      },
    });

    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(readFileSync(envCapture, 'utf8'), 'failing\ninfo\n');
    assert.equal(
      readFileSync(resourceCapture, 'utf8'),
      `${join(artifactRoot, 'detox-resource-samples.log')}\n`,
    );
    assert.match(readFileSync(samplerCallsPath, 'utf8'), /^top /m);
    assert.match(readFileSync(join(artifactRoot, 'detox-resource-samples.log'), 'utf8'), /Pages free:/);
  } finally {
    rmSync(artifactRoot, { recursive: true, force: true });
    rmSync(join(repositoryRoot, 'apps/mobile', artifactRelativePath), { recursive: true, force: true });
    rmSync(tempDirectory, { recursive: true, force: true });
    if (createdArtifactParent && readdirSync(artifactParent).length === 0) rmdirSync(artifactParent);
  }
});
