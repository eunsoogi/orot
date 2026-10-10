import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const readRepositoryFile = (path) =>
  readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8');
const e2eWorkflow = readRepositoryFile('.github/workflows/e2e-test.yml');
const codeWorkflow = readRepositoryFile('.github/workflows/quality-linux.yml');
const unitTestWorkflow = readRepositoryFile('.github/workflows/unit-test.yml');
const policyCheckWorkflow = readRepositoryFile('.github/workflows/policy-check.yml');
const qualityCli = readRepositoryFile('scripts/quality/quality.mjs');
const platformSelector = readRepositoryFile('scripts/quality/platforms.mjs');
const surfacePolicy = JSON.parse(readRepositoryFile('scripts/quality/surface-policy.json'));

function jobBlock(source, jobId) {
  const start = source.indexOf(`  ${jobId}:\n`);
  if (start < 0) return '';
  const nextJob = /\n {2}[a-z0-9_-]+:\n/.exec(source.slice(start + 1));
  return source.slice(start, nextJob ? start + 1 + nextJob.index : undefined);
}

test('runs a full-inventory lint leaf for every language surface on Linux', () => {
  const lint = jobBlock(codeWorkflow, 'surface_lint');
  assert.match(lint, /strategy:\n\s+fail-fast: false/);
  assert.match(lint, /name: Lint \/ \$\{\{ matrix\.label \}\}/);
  assert.match(lint, /runs-on: ubuntu-24\.04/);
  for (const surface of Object.keys(surfacePolicy.surfaces)) {
    assert.ok(lint.includes(`surface: ${surface}`), `missing ${surface} lint leaf`);
  }
  assert.ok(lint.includes('pnpm quality:inventory'));
  assert.match(lint, /pnpm lint -- --platform linux --surface "\$\{\{ matrix\.surface \}\}"/);
  assert.doesNotMatch(lint, /--exclude|changed-files|paths-filter/);
  assert.ok(lint.includes('tool-versions.json'));
  assert.ok(lint.includes('ci-quality-lint-${{ matrix.surface }}-${{ github.run_id }}'));
});

test('publishes inventory and canonical source LOC as separate Linux checks', () => {
  const inventory = jobBlock(codeWorkflow, 'inventory');
  const loc = jobBlock(codeWorkflow, 'source_loc');

  assert.match(inventory, /name: Maintained file inventory/);
  assert.match(inventory, /runs-on: ubuntu-24\.04/);
  assert.ok(inventory.includes('pnpm quality:inventory'));
  assert.ok(inventory.includes('quality-inventory.log'));
  assert.match(loc, /name: Source LOC policy/);
  assert.match(loc, /runs-on: ubuntu-24\.04/);
  assert.match(loc, /fetch-depth: 0/);
  assert.ok(
    loc.includes(
      "LOC_BASE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event.before }}",
    ),
  );
  assert.match(
    loc,
    /if \[\[ "\$GITHUB_EVENT_NAME" == workflow_dispatch \]\]; then[\s\S]*?scripts\/ci\/check-loc\.mjs --all[\s\S]*?else[\s\S]*?scripts\/ci\/check-loc\.mjs --base "\$LOC_BASE_SHA"/,
  );
  assert.doesNotMatch(loc, /git merge-base origin\/main HEAD/);
});

test('keeps formatting, unit, and policy checks as independent Linux leaves', () => {
  const format = jobBlock(codeWorkflow, 'format_check');
  assert.match(format, /name: Format check/);
  assert.match(format, /runs-on: ubuntu-24\.04/);
  assert.ok(format.includes('pnpm format:check -- --platform linux'));
  assert.doesNotMatch(format, /--surface/);

  const unitJobs = [
    ['typecheck', 'TypeScript typecheck', 'pnpm typecheck'],
    ['unit_tests', 'Unit and component tests', 'scripts/ci/run-test-suite.sh unit'],
  ];
  for (const [jobId, name, command] of unitJobs) {
    const job = jobBlock(unitTestWorkflow, jobId);
    assert.ok(job, `missing ${jobId} leaf`);
    assert.ok(job.includes(`name: ${name}`));
    assert.match(job, /runs-on: ubuntu-24\.04/);
    assert.ok(job.includes(command), `${name} command changed`);
    assert.doesNotMatch(job, /^\s+needs:/m, `${name} cannot depend on an aggregate job`);
  }

  const policyJob = jobBlock(policyCheckWorkflow, 'gate_tests');
  assert.ok(policyJob, 'missing policy-test leaf');
  assert.ok(policyJob.includes('name: CI, release, and quality gate tests'));
  assert.match(policyJob, /runs-on: ubuntu-24\.04/);
  assert.ok(
    policyJob.includes(
      'scripts/ci/tests/*.test.mjs scripts/release/tests/*.test.mjs scripts/quality/tests/*.test.mjs',
    ),
  );
  assert.doesNotMatch(policyJob, /^\s+needs:/m);
  // Separate contexts let branch protection identify failures by responsibility.
  assert.doesNotMatch(unitTestWorkflow, /^\x20{2}gate_tests:/m);
  assert.doesNotMatch(policyCheckWorkflow, /^\x20{2}(typecheck|unit_tests):/m);
});

test('pins the policy-test Ruby runtime and keeps its logs outside checkout inventory', () => {
  const gate = jobBlock(policyCheckWorkflow, 'gate_tests');
  const expectedRubyVersion = codeWorkflow.match(/EXPECTED_RUBY_VERSION: '([^']+)'/)?.[1];

  assert.ok(expectedRubyVersion, 'Code Quality must declare the Ruby version');
  assert.ok(policyCheckWorkflow.includes(`EXPECTED_RUBY_VERSION: '${expectedRubyVersion}'`));
  assert.match(gate, /uses: ruby\/setup-ruby@[a-f0-9]{40}/);
  assert.ok(gate.includes('ruby-version: ${{ env.EXPECTED_RUBY_VERSION }}'));
  assert.ok(
    gate.includes(
      'run: scripts/ci/run-command.sh install "$RUNNER_TEMP/orot-gate-tests/install.log" -- pnpm install --frozen-lockfile',
    ),
  );
  assert.ok(
    gate.includes(
      'run: scripts/ci/run-command.sh gate-tests "$RUNNER_TEMP/orot-gate-tests/gate-tests.log" -- node --test scripts/ci/tests/*.test.mjs scripts/release/tests/*.test.mjs scripts/quality/tests/*.test.mjs',
    ),
  );
  assert.ok(gate.includes('path: ${{ runner.temp }}/orot-gate-tests/'));
  assert.doesNotMatch(gate, /artifacts\/gate-tests/);
});

test('uses singular workflow names and matching paths with direct checks and cancellation rules', () => {
  const directTriggers =
    'on:\n  pull_request:\n    branches: [main]\n  push:\n    branches: [main]\n  workflow_dispatch:';

  assert.match(codeWorkflow, /^name: Code Quality$/m);
  assert.match(unitTestWorkflow, /^name: Unit Test$/m);
  assert.match(policyCheckWorkflow, /^name: Policy Check$/m);
  assert.match(e2eWorkflow, /^name: E2E Test$/m);
  for (const workflow of [codeWorkflow, unitTestWorkflow, policyCheckWorkflow, e2eWorkflow]) {
    assert.ok(workflow.includes(directTriggers));
    assert.ok(
      workflow.includes(
        'group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}',
      ),
    );
    assert.ok(workflow.includes('cancel-in-progress: true'));
    assert.match(workflow, /^permissions:\n {2}contents: read/m);
    assert.doesNotMatch(workflow, /workflow_call/);
  }
  assert.doesNotMatch(e2eWorkflow, /quality_code:|quality_tests:/);
  assert.doesNotMatch(e2eWorkflow, /uses: \.\/\.github\/workflows\/quality-linux/);
  assert.match(e2eWorkflow, /^\x20{2}ios-simulator-build:\n\x20{4}name: iOS Simulator Build$/m);
  assert.match(e2eWorkflow, /runs-on: xcode-27/);
  assert.doesNotMatch(e2eWorkflow, /name: Detox iOS E2E/);
  assert.doesNotMatch(e2eWorkflow, /detox_ios_e2e:/);
});

test('surface selection validates the complete inventory before filtering one lint surface', () => {
  assert.match(qualityCli, /const inventory = await buildInventory\(\)/);
  assert.match(qualityCli, /selectSurfaceEntries\(platformEntries, policy, surface\)/);
  assert.match(qualityCli, /surface selection cannot be combined with path exclusions/);
  assert.match(qualityCli, /if \(!surface && !entries\.some/);
  assert.doesNotMatch(
    platformSelector,
    /No maintained files are selected for the \$\{surface\} quality surface/,
  );
});
