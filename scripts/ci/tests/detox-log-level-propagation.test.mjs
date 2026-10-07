import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { installDetoxHostSamplerStubs } from './detox-host-sampling-stubs.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const suiteRunner = join(repositoryRoot, 'scripts/ci/run-test-suite.sh');
const releaseSimulatorId = 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE';

function runReleaseSuite(logLevel) {
  // Keep generated logs in the ignored mobile artifact root so concurrent inventory checks skip them.
  const artifactParent = join(repositoryRoot, 'apps/mobile/artifacts');
  const createdArtifactParent = !existsSync(artifactParent);
  mkdirSync(artifactParent, { recursive: true });
  const artifactRoot = mkdtempSync(join(artifactParent, '.ci-detox-log-level-'));
  const tempDirectory = mkdtempSync(join(tmpdir(), 'orot-detox-log-level-'));
  const fakePnpm = join(tempDirectory, 'pnpm');
  const capturePath = join(tempDirectory, 'log-level.txt');
  const invocationPath = join(tempDirectory, 'pnpm-invoked');

  try {
    writeFileSync(
      fakePnpm,
      [
        '#!/usr/bin/env bash',
        'printf \'%s\\n\' "${OROT_DETOX_TEST_LOG_LEVEL:-info}" > "$DETOX_LOG_LEVEL_CAPTURE"',
        ': > "$DETOX_PNPM_INVOKED"',
        "printf 'Test Suites: 1 passed, 1 total\\nTests: 8 passed, 8 total\\n'",
      ].join('\n'),
      { mode: 0o755 },
    );
    installDetoxHostSamplerStubs(tempDirectory);
    const env = { ...process.env };
    delete env.OROT_DETOX_TEST_LOG_LEVEL;
    Object.assign(env, {
      DETOX_LOG_LEVEL_CAPTURE: capturePath,
      DETOX_PNPM_INVOKED: invocationPath,
      GITHUB_ACTIONS: 'false',
      OROT_DETOX_TEST_TIME_COMMAND: join(tempDirectory, 'time'),
      OROT_DETOX_SIMULATOR_UDID: releaseSimulatorId,
      OROT_OPENAI_PROVIDER_SIMULATOR_UDID: '',
      OROT_DETOX_RESOURCE_SAMPLING: 'false',
      PATH: [tempDirectory, env.PATH].join(':'),
    });
    if (logLevel !== undefined) env.OROT_DETOX_TEST_LOG_LEVEL = logLevel;

    const result = spawnSync(
      'bash',
      [suiteRunner, 'e2e-release', relative(repositoryRoot, artifactRoot)],
      { cwd: repositoryRoot, encoding: 'utf8', env },
    );
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      capturedLogLevel: existsSync(capturePath) ? readFileSync(capturePath, 'utf8') : null,
      pnpmInvoked: existsSync(invocationPath),
    };
  } finally {
    rmSync(artifactRoot, { recursive: true, force: true });
    rmSync(tempDirectory, { recursive: true, force: true });
    if (createdArtifactParent && readdirSync(artifactParent).length === 0)
      rmdirSync(artifactParent);
  }
}

test('forwards an explicitly requested trace level through the Release wrapper', () => {
  const result = runReleaseSuite('trace');

  assert.equal(result.status, 0, result.output);
  assert.equal(result.capturedLogLevel, 'trace\n');
});

test('keeps info as the Release wrapper default', () => {
  const result = runReleaseSuite(undefined);

  assert.equal(result.status, 0, result.output);
  assert.equal(result.capturedLogLevel, 'info\n');
});

test('rejects an unsupported log level before launching Detox', () => {
  const result = runReleaseSuite('loud');

  assert.equal(result.status, 2, result.output);
  assert.match(result.output, /Unsupported Detox log level: loud/);
  assert.equal(result.pnpmInvoked, false);
});
