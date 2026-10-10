import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const readRepositoryFile = (path) =>
  readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8');
const ciWorkflow = readRepositoryFile('.github/workflows/ci.yml');
const codeWorkflow = readRepositoryFile('.github/workflows/quality-linux.yml');
const testWorkflow = readRepositoryFile('.github/workflows/quality-linux-tests.yml');
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
  assert.match(
    loc,
    /if \[\[ "\$GITHUB_EVENT_NAME" == workflow_dispatch \]\]; then[\s\S]*?scripts\/ci\/check-loc\.mjs --all[\s\S]*?else[\s\S]*?scripts\/ci\/check-loc\.mjs --base "\$LOC_BASE_SHA"/,
  );
});

test('keeps formatting, typecheck, unit tests, and policy tests as independent Linux leaves', () => {
  const format = jobBlock(codeWorkflow, 'format_check');
  assert.match(format, /name: Format check/);
  assert.match(format, /runs-on: ubuntu-24\.04/);
  assert.ok(format.includes('pnpm format:check -- --platform linux'));
  assert.doesNotMatch(format, /--surface/);

  const expected = [
    ['typecheck', 'TypeScript typecheck', 'pnpm typecheck'],
    ['unit_tests', 'Unit and component tests', 'scripts/ci/run-test-suite.sh unit'],
    [
      'gate_tests',
      'CI, release, and quality gate tests',
      'scripts/ci/tests/*.test.mjs scripts/release/tests/*.test.mjs scripts/quality/tests/*.test.mjs',
    ],
  ];
  for (const [jobId, name, command] of expected) {
    const job = jobBlock(testWorkflow, jobId);
    assert.ok(job, `missing ${jobId} leaf`);
    assert.ok(job.includes(`name: ${name}`));
    assert.match(job, /runs-on: ubuntu-24\.04/);
    assert.ok(job.includes(command), `${name} command changed`);
    assert.doesNotMatch(job, /^\s+needs:/m, `${name} cannot depend on an aggregate job`);
  }
});

test('pins the policy-test Ruby runtime and keeps its logs outside checkout inventory', () => {
  const gate = jobBlock(testWorkflow, 'gate_tests');
  const expectedRubyVersion = codeWorkflow.match(/EXPECTED_RUBY_VERSION: '([^']+)'/)?.[1];

  assert.ok(expectedRubyVersion, 'Linux code checks must declare the Ruby version');
  assert.ok(testWorkflow.includes(`EXPECTED_RUBY_VERSION: '${expectedRubyVersion}'`));
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

test('removes quality aggregate checks while preserving the production build check', () => {
  assert.match(
    ciWorkflow,
    /quality_code:[\s\S]*?uses: \.\/\.github\/workflows\/quality-linux\.yml/,
  );
  assert.match(
    ciWorkflow,
    /quality_tests:[\s\S]*?uses: \.\/\.github\/workflows\/quality-linux-tests\.yml/,
  );
  assert.doesNotMatch(ciWorkflow, /^\x20{2}quality_linux:/m);
  assert.doesNotMatch(ciWorkflow, /^\x20{2}quality:\n/m);
  assert.doesNotMatch(ciWorkflow, /name: Quality Linux|name: Quality\n/);
  assert.doesNotMatch(ciWorkflow, /require-quality-aggregate\.mjs/);
  assert.match(ciWorkflow, /^\x20{2}ios-simulator-build:\n\x20{4}name: iOS Simulator Build$/m);
  assert.match(ciWorkflow, /runs-on: xcode-27/);
  assert.doesNotMatch(ciWorkflow, /name: Detox iOS E2E/);
  assert.doesNotMatch(ciWorkflow, /detox_ios_e2e:/);
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
