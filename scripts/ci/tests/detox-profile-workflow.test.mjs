import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const profileWorkflow = readFileSync(
  join(repositoryRoot, '.github/workflows/detox-e2e-profile.yml'),
  'utf8',
);
const ciWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
const runner = readFileSync(join(repositoryRoot, 'scripts/ci/run-detox-e2e.sh'), 'utf8');

test('keeps profile build, Simulator lifecycle, E2E, failure diagnostics, cleanup and upload in order', () => {
  const build = profileWorkflow.indexOf('- name: Build Detox iOS Simulator app');
  const prepare = profileWorkflow.indexOf('- name: Prepare dedicated Detox Simulator');
  const boot = profileWorkflow.indexOf('- name: Wait for dedicated Detox Simulator');
  const tests = profileWorkflow.indexOf('- name: Run Detox iOS Simulator tests');
  const diagnostics = profileWorkflow.indexOf('- name: Collect simulator logs');
  const teardown = profileWorkflow.indexOf('- name: Delete dedicated Detox Simulator');
  const upload = profileWorkflow.indexOf(
    '- name: Upload Detox reports, logs, screenshots, and videos',
  );
  const testStepStart = profileWorkflow.indexOf('- name: Run Detox iOS Simulator tests');
  const testStepEnd = profileWorkflow.indexOf('\n      - name:', testStepStart + 1);
  const testStep = profileWorkflow.slice(testStepStart, testStepEnd);

  assert.ok(build >= 0 && prepare > build && boot > prepare && tests > boot);
  assert.ok(diagnostics > tests && teardown > diagnostics && upload > teardown);
  assert.match(testStep, /timeout-minutes: 45/);
  assert.match(testStep, /run: scripts\/ci\/run-test-suite\.sh/);
  assert.match(profileWorkflow, /if: \$\{\{ always\(\) \}\}/);
  assert.doesNotMatch(profileWorkflow, /mdutil|Spotlight|spotlight/i);
  assert.doesNotMatch(ciWorkflow, /mdutil|Spotlight|spotlight/i);
});

test('leaves heavy resource sampling off unless a manual run requests it and caps samples', () => {
  assert.match(
    ciWorkflow,
    /workflow_dispatch:[\s\S]*?detox_resource_sampling:[\s\S]*?type: boolean[\s\S]*?default: false/,
  );
  assert.match(
    ciWorkflow,
    /if \[\[ "\$GITHUB_EVENT_NAME" == workflow_dispatch \]\]; then[\s\S]*?scripts\/ci\/check-loc\.mjs --all[\s\S]*?else[\s\S]*?scripts\/ci\/check-loc\.mjs --base "\$LOC_BASE_SHA"/,
  );
  assert.match(
    profileWorkflow,
    /resource_sampling:[\s\S]*?required: false[\s\S]*?type: boolean[\s\S]*?default: false/,
  );
  assert.equal(
    (
      ciWorkflow.match(
        /resource_sampling: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.detox_resource_sampling == true \}\}/g,
      ) || []
    ).length,
    2,
  );
  assert.match(
    profileWorkflow,
    /OROT_DETOX_RESOURCE_SAMPLING: \$\{\{ inputs\.resource_sampling \}\}/,
  );
  assert.match(runner, /resource_sample_limit=4/);
  assert.match(runner, /sample_index < resource_sample_limit/);
});
