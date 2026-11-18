import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const ios = 'apps/mobile/ios/OrotUITests/';

test('current Routes checks every real saved kind and the same appointment question without restoring history', () => {
  const source = read(`${ios}AiFeatureNavigationUITests.swift`);
  const body = source.slice(
    source.indexOf('func testAiScreensAndSeparateHistoriesAcrossAppearanceChanges'),
    source.indexOf('/// Numeric records'),
  );
  assert.match(body, /OROT_ROUTES_GENERATED_RECORDS", "synthetic"/);
  assert.match(body, /OROT_IOS_FIXTURE_SESSION/);
  assert.match(body, /GeneratedRecordsRoutesUITestConditions.inspect/);
  assert.doesNotMatch(
    body,
    /rag-conversation-sessions-toggle|conversation-history-screen|saved-visit-questions-screen/,
  );
  const helper = read(`${ios}GeneratedRecordsRoutesUITestConditions.swift`);
  const fixture = read('apps/mobile/e2e/routesGeneratedRecordsFixture.ts');
  for (const id of [
    'synthetic-routes-possibilities',
    'synthetic-routes-health-summary',
    'synthetic-routes-daily-report',
    'synthetic-routes-appointment',
  ]) {
    assert.ok(helper.includes(id) && fixture.includes(id), id);
  }
  for (const text of [
    '합성 기록에서 살펴볼 가능성이에요.',
    '합성 건강 정보 요약이에요.',
    '합성 오늘의 보고서예요.',
    '합성 건강 기록을 진료에서 확인할까요?',
  ]) {
    assert.ok(helper.includes(text) && fixture.includes(text), text);
  }
  for (const required of [
    '목록으로',
    '닫기',
    'generated-report-detail',
    'overview-prepare-visit',
    'visit-day-questions',
    'navigation-back',
    'navigation-tab-records',
    'inference-disclosure-sheet',
  ])
    assert.ok(helper.includes(required));
  assert.match(
    helper,
    /XCTAssertFalse\(UITestConditions.element\(app, "rag-conversation-sessions-toggle"\).exists\)/,
  );
  assert.match(body, /for dark in \[false, true\]/);
  assert.match(body, /UICTContentSizeCategoryAccessibilityXXXL/);
  for (const id of [
    'open-medical-appointments',
    'medical-appointment-select-provider',
    'settings-provider-screen',
  ])
    assert.ok(body.includes(id));
});

test('fixture stays opt-in and mounted only after awaited production writes', () => {
  for (const file of ['capabilityTestEntry.ts', 'e2eRouterEntry.tsx'])
    assert.ok(read(`apps/mobile/e2e/${file}`).includes('routesGeneratedRecordsEnabled('));
  const entry = read('apps/mobile/e2e/routesGeneratedRecordsProbeEntry.tsx');
  assert.match(entry, /state === 'ready' \? \(\s*<App \/>/);
  assert.match(entry, /nativeTestControl: Boolean\(NativeModules.OrotTestControl\)/);
  assert.match(entry, /seed: seedRoutesGeneratedRecords/);
  const project = read('apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj');
  assert.equal((project.match(/GeneratedRecordsRoutesUITestConditions.swift/g) ?? []).length, 6);
});

// The ordinary entry must not eagerly evaluate storage before native polyfills.
test('router admission remains pure and preserves the existing polyfill-first boundary', () => {
  const selection = read('apps/mobile/e2e/routesGeneratedRecordsSelection.ts');
  assert.doesNotMatch(selection, /import |require\(/);
  const router = read('apps/mobile/e2e/e2eRouterEntry.tsx');
  assert.ok(router.startsWith("import 'react-native-get-random-values';"));
  for (const file of ['capabilityTestEntry.ts', 'e2eRouterEntry.tsx']) {
    const source = read(`apps/mobile/e2e/${file}`);
    assert.ok(source.includes("from './routesGeneratedRecordsSelection'"));
    assert.ok(!source.includes("from './routesGeneratedRecordsPreparation'"));
  }
});
