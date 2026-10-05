import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const ciWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
const profileWorkflow = readFileSync(
  join(repositoryRoot, '.github/workflows/detox-e2e-profile.yml'),
  'utf8',
);
const runner = readFileSync(join(repositoryRoot, 'scripts/ci/run-detox-e2e.sh'), 'utf8');

test('enables built-in Detox trace only for a manually requested diagnostic run', () => {
  assert.match(ciWorkflow, /detox_trace:[\s\S]*?default: false\n[ ]{6}detox_resource_sampling/);
  const traceInputs = ciWorkflow.match(/trace_logging:[^\n]+/g) || [];
  assert.equal(traceInputs.length, 2);
  assert.ok(
    traceInputs.every(
      (line) =>
        line.includes("github.event_name == 'workflow_dispatch'") &&
        line.includes('inputs.detox_trace == true'),
    ),
  );
  assert.match(profileWorkflow, /trace_logging: \{ type: boolean, default: false \}/);
  assert.match(profileWorkflow, /OROT_DETOX_TEST_LOG_LEVEL=.*'trace'.*'info'/);
  assert.match(runner, /OROT_DETOX_TEST_LOG_LEVEL:-info/);
  assert.match(runner, /fatal \| error \| warn \| info \| verbose \| debug \| trace/);
});
