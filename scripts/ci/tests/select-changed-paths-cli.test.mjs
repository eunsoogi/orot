import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CHECK_KEYS } from '../changed-paths-core.mjs';

const CLI_PATH = fileURLToPath(new URL('../select-changed-paths.mjs', import.meta.url));

function runManualDispatch(outputPath, ref = 'refs/heads/main', includeSummary = false) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-ci-paths-'));
  const eventPath = join(directory, 'event.json');
  const summaryPath = join(directory, 'summary.md');
  writeFileSync(eventPath, '{}');
  try {
    const result = spawnSync(process.execPath, [CLI_PATH], {
      encoding: 'utf8',
      cwd: directory,
      env: {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
        GITHUB_REF: ref,
        ...(includeSummary ? { GITHUB_STEP_SUMMARY: summaryPath } : {}),
      },
    });
    const reportPath = join(directory, 'artifacts/ios-e2e-selection.json');
    return {
      result,
      report: existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null,
      summary: existsSync(summaryPath) ? readFileSync(summaryPath, 'utf8') : null,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('CLI writes a full-verification selection for manual GitHub Actions runs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-ci-paths-output-'));
  const outputPath = join(directory, 'output');
  try {
    const { result, report } = runManualDispatch(outputPath);
    assert.equal(result.status, 0, result.stderr);
    const outputs = Object.fromEntries(
      readFileSync(outputPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split('=')),
    );
    assert.equal(outputs.all, 'true');
    assert.equal(outputs.reason, 'manual-full-inventory-selection');
    assert.equal(outputs.validation_tier, 'full');
    assert.equal(outputs.selection_complete, 'true');
    assert.equal(
      CHECK_KEYS.every((key) => outputs[key] === 'true'),
      true,
    );
    assert.equal(report.schemaVersion, 2);
    assert.equal(report.validationTier, 'full');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI fails the owning check when GitHub Actions omits its output file', () => {
  const { result } = runManualDispatch('');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /required checks must fail safe/);
});

test('off-main manual dispatch is described as diagnostic without protected iOS execution', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-ci-paths-output-'));
  const outputPath = join(directory, 'output');
  try {
    const { result, report, summary } = runManualDispatch(outputPath, 'refs/heads/feature', true);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(report.validationTier, 'diagnostic');
    assert.match(summary, /diagnostic selection only; protected iOS validation is not scheduled/);
    assert.doesNotMatch(summary, /scheduled for automatic execution/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
