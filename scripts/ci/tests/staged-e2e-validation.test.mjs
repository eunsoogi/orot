import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { selectChecksForPaths } from '../changed-paths-select.mjs';
import { resolveFullValidationDeferred } from '../select-changed-paths.mjs';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(fileURLToPath(new URL(path, root)), 'utf8');

test('only an explicitly drafted pull request defers full E2E validation', () => {
  assert.equal(
    resolveFullValidationDeferred('pull_request', { pull_request: { draft: true } }),
    true,
  );
  for (const [event, payload] of [
    ['pull_request', { pull_request: { draft: false } }],
    ['pull_request', { pull_request: {} }],
    ['push', { pull_request: { draft: true } }],
    ['workflow_dispatch', { pull_request: { draft: true } }],
    ['pull_request', null],
  ]) {
    assert.equal(resolveFullValidationDeferred(event, payload), false, `${event} ${payload}`);
  }
});

test('draft mode does not weaken conservative changed-path selection', () => {
  const docs = selectChecksForPaths(['docs/development.md']);
  assert.equal(docs.policy_tests, true);
  assert.equal(docs.ios_build, false);
  assert.equal(docs.ios_tests, false);

  const integration = selectChecksForPaths(['apps/mobile/ios/OrotMobile/AppDelegate.swift']);
  assert.equal(integration.ios_tests, true);
});

test('E2E is triggered only by its daily main schedule while receipt safeguards remain active', () => {
  const source = read('.github/workflows/e2e-test.yml');
  const e2e = yaml.load(source);
  assert.deepEqual(Object.keys(e2e.on), ['schedule']);
  assert.deepEqual(e2e.on.schedule, [{ cron: '0 18 * * *' }]);
  assert.equal(existsSync(fileURLToPath(new URL('.github/workflows/e2e-selected.yml', root))), false);
  assert.match(source, /deferred: \$\{\{ steps\.select\.outputs\.full_validation_deferred \}\}/);
  assert.match(source, /steps\.select\.outputs\.validation_tier != 'diagnostic'/);
  assert.match(source, /metadata_only_edit != 'true'/);
  assert.match(source, /needs\.completeness\.result/);
  const receipt = read('.github/actions/ios-e2e-validation-receipt/action.yml');
  assert.match(receipt, /test "\$COMPLETE" = true[\s\S]*test "\$DIAGNOSTIC" != true/);
  assert.match(receipt, /test "\$METADATA_ONLY_EDIT" != true \|\| test "\$REUSE_RESULT" = success/);
  assert.match(
    source,
    /invalid_selection:.*complete != 'true'.*deferred == 'true'.*diagnostic == 'true'/,
  );
  const status = read('.github/workflows/ios-required-statuses.yml');
  assert.match(status, /process\.env\.INVALID === "true"/);
  assert.match(status, /process\.env\.REUSE_RESULT !== "success"/);
  assert.match(status, /EXECUTION_RESULT !== "success"/);
  assert.match(status, /An unselected E2E run must have no cohorts and no execution/);
  assert.doesNotMatch(source, /detox-e2e-profile|run-detox/);
  for (const path of ['code-quality.yml', 'unit-test.yml', 'policy-check.yml'])
    assert.match(read('.github/workflows/' + path), /types: \[opened, synchronize, reopened\]/);
});

test('focused reusable workflow has no active public entry point', () => {
  assert.equal(existsSync(fileURLToPath(new URL('.github/workflows/e2e-selected.yml', root))), false);
  const focus = read('.github/workflows/ios-focused.yml');
  assert.match(focus, /^on:\n  workflow_call:/m);
  assert.match(
    focus,
    /group: focused-ios-\$\{\{ inputs\.pr_number \|\| github\.run_id \}\}-scenario/,
  );
  assert.match(focus, /cancel-in-progress: true/);
  assert.match(focus, /ios-focused-selection-cli\.mjs/);
  assert.match(focus, /ios-focused-results\.mjs/);
  assert.doesNotMatch(focus, /ios-profile-status/);
  const full = yaml.load(read('.github/workflows/e2e-test.yml'));
  assert.deepEqual(Object.keys(full.on), ['schedule']);
  assert.equal(full.jobs.debug_execution.uses, './.github/workflows/ios-debug-tests.yml');
  assert.equal(full.jobs.release_execution.uses, './.github/workflows/ios-release-tests.yml');
});
