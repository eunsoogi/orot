import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Production and OAuth keep their real build/default-keychain boundaries even though their status is aggregated on Linux.
test('production cache reuse skips only app compilation, preserving separate OAuth and receipt verification', () => {
  const action = readFileSync('.github/actions/ios-test-products-build/action.yml', 'utf8');
  assert.match(action, /ios-cache-fingerprint-cli\.mjs --derived-data-only/);
  assert.match(action, /ios-derived-data-cache\.mjs prepare production/);
  assert.match(action, /ios-derived-data-cache\.mjs write production/);
  assert.match(
    action,
    /key: orot-ios-production-v1-.*macos_version.*xcodebuild_fingerprint.*platform_dependencies.*build_inputs/,
  );
  assert.match(action, /apps\/mobile\/ios\/build-production\n\s+apps\/mobile\/ios\/Pods/);
  assert.match(action, /app_reusable != 'true'/);
  assert.match(action, /verify-simulator-keychain-defaults\.mjs/);
  assert.match(action, /swift test --package-path packages\/provider-openai/);
  assert.match(
    action,
    /derivedDataPath "\$RUNNER_TEMP\/orot-openai-oauth-derived" CODE_SIGNING_ALLOWED=NO build/,
  );
  assert.ok(action.indexOf('ios-oauth-build') < action.indexOf('ios-production-receipt.mjs write'));
  assert.ok(
    action.indexOf('ios-production-receipt.mjs write') < action.indexOf('build-ios-tests.mjs'),
  );
});

test('production status reads the actual preserved filename and fails for diagnostic selection', () => {
  const e2e = readFileSync('.github/workflows/e2e-test.yml', 'utf8');
  const product = readFileSync('.github/workflows/ios-test-build-and-execute.yml', 'utf8');
  assert.match(
    e2e,
    /ios-production-receipt\.mjs verify artifacts\/production-receipt\/production-receipt\.json/,
  );
  assert.match(product, /path: artifacts\/ios-focus\/production-receipt\.json/);
  assert.match(product, /if: \$\{\{ always\(\) && inputs\.production_build \}\}/);
  assert.match(e2e, /test "\$DIAGNOSTIC" != true/);
});
