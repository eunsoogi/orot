import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workflowPath = fileURLToPath(
  new URL('../../../.github/workflows/detox-e2e-profile-status.yml', import.meta.url),
);
const workflow = readFileSync(workflowPath, 'utf8');
const profileStatus = workflow.slice(workflow.indexOf('  profile_status:\n'));

// Cases use the parsed workflow conditions and actual shell bodies so gate edits stay covered.
const conditions = new Map([
  ['inputs.path_selection_failed', (inputs) => inputs.path_selection_failed],
  [
    "inputs.run_profile && inputs.execution_result != 'success' && !inputs.path_selection_failed",
    (inputs) =>
      inputs.run_profile && inputs.execution_result !== 'success' && !inputs.path_selection_failed,
  ],
  [
    '!inputs.run_profile && !inputs.path_selection_failed',
    (inputs) => !inputs.run_profile && !inputs.path_selection_failed,
  ],
]);

function stepBlock(name) {
  const marker = `      - name: ${name}\n`;
  const start = profileStatus.indexOf(marker);
  assert.notEqual(start, -1, `missing workflow step: ${name}`);
  const next = profileStatus.indexOf('\n      - name: ', start + marker.length);
  return profileStatus.slice(start, next === -1 ? undefined : next);
}

function stepCondition(block) {
  const match = /^\s+if: \$\{\{\s*(.*?)\s*\}\}$/m.exec(block);
  assert.ok(match, 'workflow step has no conditional expression');
  return match[1];
}

function stepCommand(block) {
  const lines = block.split('\n');
  const runLine = lines.findIndex((line) => line.trim() === 'run: |');
  assert.notEqual(runLine, -1, 'workflow step has no inline command');
  const command = [];
  for (const line of lines.slice(runLine + 1)) {
    if (line === '') {
      command.push('');
      continue;
    }
    if (!line.startsWith('          ')) break;
    command.push(line.slice(10));
  }
  assert.ok(
    command.some((line) => line.trim()),
    'workflow step command is empty',
  );
  return command.join('\n');
}

function runStatusGate(inputs) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'orot-detox-status-'));
  const summaryPath = join(temporaryDirectory, 'summary.md');
  const steps = [
    'Fail if changed-path selection was unavailable',
    'Propagate selected profile failure',
    'Record unselected profile',
  ];
  const executed = [];
  let exitCode = 0;

  try {
    for (const name of steps) {
      const block = stepBlock(name);
      const condition = stepCondition(block);
      const evaluate = conditions.get(condition);
      assert.ok(evaluate, `uncovered workflow condition: ${condition}`);
      if (!evaluate(inputs)) continue;

      executed.push(name);
      const result = spawnSync(
        'bash',
        ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', stepCommand(block)],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            E2E_PROFILE: inputs.profile,
            GITHUB_STEP_SUMMARY: summaryPath,
            PROFILE_EXECUTION_RESULT: inputs.execution_result,
          },
        },
      );
      if (result.error) throw result.error;
      assert.equal(result.signal, null, `${name} terminated by signal`);
      if (result.status !== 0) {
        exitCode = result.status ?? 1;
        break;
      }
    }
    return {
      exitCode,
      executed,
      summary: existsSync(summaryPath) ? readFileSync(summaryPath, 'utf8') : '',
    };
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

test('passes when an unselected profile executor is skipped', () => {
  const result = runStatusGate({
    execution_result: 'skipped',
    path_selection_failed: false,
    profile: 'openai-provider',
    run_profile: false,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.executed, ['Record unselected profile']);
  assert.match(result.summary, /path selector did not select this profile/);
});

test('passes when the selected profile succeeds', () => {
  const result = runStatusGate({
    execution_result: 'success',
    path_selection_failed: false,
    profile: 'openai-provider',
    run_profile: true,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.executed, []);
});

test('fails closed when changed-path selection fails', () => {
  const result = runStatusGate({
    execution_result: 'skipped',
    path_selection_failed: true,
    profile: 'openai-provider',
    run_profile: false,
  });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.executed, ['Fail if changed-path selection was unavailable']);
});

for (const executionResult of ['failure', 'cancelled', 'skipped']) {
  test(`fails when a selected profile is ${executionResult}`, () => {
    const result = runStatusGate({
      execution_result: executionResult,
      path_selection_failed: false,
      profile: 'openai-provider',
      run_profile: true,
    });
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.executed, ['Propagate selected profile failure']);
  });
}
