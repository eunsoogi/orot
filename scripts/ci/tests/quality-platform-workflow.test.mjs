import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Keep the required check name and the platform-specific command ownership visible in CI source.
const workflow = readFileSync(
  fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url)),
  'utf8',
);
const linuxWorkflow = readFileSync(
  fileURLToPath(new URL('../../../.github/workflows/quality-linux.yml', import.meta.url)),
  'utf8',
);
const linuxJob = linuxWorkflow.slice(linuxWorkflow.indexOf('jobs:'));
const linuxCall = workflow.slice(
  workflow.indexOf('  quality_linux:'),
  workflow.indexOf('  quality:'),
);
const aggregateJob = workflow.slice(
  workflow.indexOf('  quality:'),
  workflow.indexOf('  ios-simulator-build:'),
);

test('keeps every portable Quality check on the Linux partition', () => {
  assert.match(linuxCall, /uses: \.\/\.github\/workflows\/quality-linux\.yml/);
  assert.match(linuxJob, /name: Quality Linux\s+runs-on: ubuntu-24\.04/);
  for (const command of [
    'pnpm-lockfile-verification',
    'verify-toolchain.sh --portable',
    'pnpm install --frozen-lockfile',
    'pnpm quality:setup -- --platform linux',
    'pnpm quality:inventory',
    'scripts/ci/tests/*.test.mjs scripts/release/tests/*.test.mjs scripts/quality/tests/*.test.mjs',
    'pnpm lint -- --platform linux',
    'pnpm format:check -- --platform linux',
    'pnpm typecheck',
    'scripts/ci/run-test-suite.sh unit artifacts/quality',
  ]) {
    assert.ok(linuxJob.includes(command), `Linux Quality is missing ${command}`);
  }
});

test('caches the pinned Linux tools and records its diagnostic artifact', () => {
  assert.ok(linuxJob.includes('Cache pinned quality tools'));
  assert.ok(linuxJob.includes('node_modules/.cache/orot-quality'));
  assert.ok(!workflow.includes('quality_macos:'));
  assert.ok(linuxJob.includes('ci-quality-linux-${{ github.run_id }}-${{ github.run_attempt }}'));
});

test('preserves the required Quality check through a fail-closed Linux aggregate', () => {
  assert.match(aggregateJob, /name: Quality\s+runs-on: ubuntu-24\.04/);
  assert.match(aggregateJob, /needs: \[quality_linux\]/);
  assert.match(aggregateJob, /if: \$\{\{ always\(\) \}\}/);
  assert.match(aggregateJob, /fetch-depth: 0/);
  assert.match(
    aggregateJob,
    /if \[\[ "\$GITHUB_EVENT_NAME" == workflow_dispatch \]\]; then[\s\S]*?scripts\/ci\/check-loc\.mjs --all[\s\S]*?else[\s\S]*?scripts\/ci\/check-loc\.mjs --base "\$LOC_BASE_SHA"/,
  );
  assert.ok(aggregateJob.includes('needs.quality_linux.result'));
  assert.ok(aggregateJob.includes('node scripts/ci/require-quality-aggregate.mjs'));
  assert.match(workflow, /^\x20{2}ios-simulator-build:\n\x20{4}name: iOS Simulator Build$/m);
  assert.match(workflow, /^\x20{2}detox_ios_e2e:\n\x20{4}name: Detox iOS E2E$/m);
});
