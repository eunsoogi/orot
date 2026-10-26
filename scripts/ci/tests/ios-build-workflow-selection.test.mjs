import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Production and OAuth keep their real build/default-keychain boundaries even though their status is aggregated on Linux.
test('production cache reuse skips only app compilation, preserving separate OAuth and receipt verification', () => {
  const action = readFileSync('.github/actions/ios-production-validation/action.yml', 'utf8');
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
  const oauthBuild = readFileSync('.github/workflows/ios-oauth-build.yml', 'utf8');
  assert.match(
    oauthBuild,
    /swift build --package-path packages\/provider-openai[^\n]+--build-tests/,
  );
  assert.match(
    oauthBuild,
    /derivedDataPath "\$RUNNER_TEMP\/orot-openai-oauth-derived" CODE_SIGNING_ALLOWED=NO build/,
  );
  assert.doesNotMatch(action, /swift test|ios-oauth-build/);
  assert.doesNotMatch(action, /build-ios-tests\.mjs/);
});

test('production status reads the actual preserved filename and fails for diagnostic selection', () => {
  const e2e = readFileSync('.github/workflows/e2e-test.yml', 'utf8');
  const receipt = readFileSync('.github/actions/ios-e2e-validation-receipt/action.yml', 'utf8');
  const product = readFileSync('.github/workflows/ios-production-validation.yml', 'utf8');
  assert.match(
    receipt,
    /ios-production-receipt\.mjs verify artifacts\/production-receipt\/production-receipt\.json/,
  );
  assert.match(e2e, /uses: \.\/\.github\/actions\/ios-e2e-validation-receipt/);
  assert.match(e2e, /diagnostic: \$\{\{ needs\.selection\.outputs\.diagnostic \}\}/);
  assert.match(product, /path: artifacts\/ios-focus\/production-receipt\.json/);
  assert.match(product, /if: always\(\)/);
  assert.match(receipt, /test "\$DIAGNOSTIC" != true/);
});
