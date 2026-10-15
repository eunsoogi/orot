import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { selectChecksForPaths } from '../changed-paths-select.mjs';
import { resolveFullValidationDeferred } from '../select-changed-paths.mjs';

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

test('unapproved drafts, focused and diagnostic runs cannot satisfy the full integration gate', () => {
  const e2e = read('.github/workflows/e2e-test.yml');
  assert.match(
    e2e,
    /types: \[opened, synchronize, reopened, ready_for_review, converted_to_draft\]/,
  );
  assert.match(e2e, /deferred: \$\{\{ steps\.select\.outputs\.full_validation_deferred \}\}/);
  assert.match(e2e, /outputs\.deferred == 'true' && needs\.completeness\.result != 'success'/);
  assert.match(e2e, /github\.event_name != 'workflow_dispatch'/);
  assert.doesNotMatch(e2e, /workflow_dispatch:|focused_scenario:/);
  assert.match(
    e2e,
    /test "\$COMPLETE" = true && test "\$DEFERRED" != true && test "\$DIAGNOSTIC" != true/,
  );
  assert.match(
    e2e,
    /invalid_selection:.*complete != 'true'.*deferred == 'true'.*diagnostic == 'true'/,
  );
  const status = read('.github/workflows/ios-required-statuses.yml');
  assert.match(status, /test "\$INVALID" = false/);
  assert.match(status, /test "\$RESULT" = success/);
  assert.match(status, /if: ['"]!inputs.selected['"]/);
  assert.doesNotMatch(e2e, /detox-e2e-profile|run-detox/);
  for (const path of ['code-quality.yml', 'unit-test.yml', 'policy-check.yml'])
    assert.match(read('.github/workflows/' + path), /ready_for_review/);
});

test('manual focus uses exact integration selection and retains PR-scoped supersession', () => {
  const selected = read('.github/workflows/e2e-selected.yml');
  assert.match(selected, /selected:[\s\S]*uses: \.\/\.github\/workflows\/ios-focused\.yml/);
  const focus = read('.github/workflows/ios-focused.yml');
  assert.match(
    focus,
    /group: focused-ios-\$\{\{ inputs\.pr_number \|\| github\.run_id \}\}-scenario/,
  );
  assert.match(focus, /cancel-in-progress: true/);
  assert.match(focus, /ios-focused-selection-cli\.mjs/);
  assert.match(focus, /ios-focused-results\.mjs/);
  assert.doesNotMatch(focus, /ios-profile-status/);
});
