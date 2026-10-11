import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CHECK_KEYS } from '../changed-paths-core.mjs';

const CLI_PATH = fileURLToPath(new URL('../select-changed-paths.mjs', import.meta.url));

function runManualDispatch(outputPath) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-ci-paths-'));
  const eventPath = join(directory, 'event.json');
  writeFileSync(eventPath, '{}');
  try {
    return spawnSync(process.execPath, [CLI_PATH], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('CLI writes a full-verification selection for manual GitHub Actions runs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-ci-paths-output-'));
  const outputPath = join(directory, 'output');
  try {
    const result = runManualDispatch(outputPath);
    assert.equal(result.status, 0, result.stderr);
    const outputs = Object.fromEntries(
      readFileSync(outputPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split('=')),
    );
    assert.equal(outputs.all, 'true');
    assert.equal(outputs.reason, 'manual-full-verification');
    assert.equal(outputs.selection_complete, 'true');
    assert.equal(
      CHECK_KEYS.every((key) => outputs[key] === 'true'),
      true,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI fails the owning check when GitHub Actions omits its output file', () => {
  const result = runManualDispatch('');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /required checks must fail safe/);
});
