import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
test('isolates direct reader host behind existing explicit probe and test bridge', () => {
  const router = read('apps/mobile/e2e/e2eRouterEntry.tsx');
  assert.match(
    router,
    /OROT_TEST_CLASSIFICATION_READER_GEOMETRY === 'YES' &&\s+NativeModules.OrotTestControl/,
  );
  assert.match(router, /else require\('\.\/medicalAppointmentClassificationProbeEntry'\)/);
  const host = read('apps/mobile/e2e/ClassificationReaderGeometryProbe.tsx');
  assert.match(host, /import \{ ClassificationPagedStage \}/);
  assert.match(host, /onAction=\{action\}/);
  assert.doesNotMatch(
    host,
    /onTextLayout|onDismiss|NativeModules|settingsConsentNativeStore|generate\(/,
  );
});
test('registers one real wide XXXL geometry journey without assuming launch success', () => {
  const swift = read('apps/mobile/ios/OrotUITests/ClassificationReaderGeometryUITests.swift');
  assert.match(swift, /XCTAssertGreaterThan\(window.width, window.height/);
  assert.match(swift, /UICTContentSizeCategoryAccessibilityXXXL/);
  assert.match(swift, /timeout: 20/);
  assert.match(swift, /XCTAssertEqual\(pages.joined/);
  for (const path of ['scripts/ci/ios-test-inventory.mjs', 'scripts/ci/duo-test-inventory.mjs'])
    assert.equal(
      read(path).split('testWideLargeTextReaderPreservesContentAndNativeDismissal').length - 1,
      1,
    );
});
