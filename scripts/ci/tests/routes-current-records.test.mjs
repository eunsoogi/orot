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
  const reports = [
    ['summary', 'synthetic-routes-possibilities', '합성 기록에서 살펴볼 가능성이에요.'],
    ['summary', 'synthetic-routes-health-summary', '합성 건강 정보 요약이에요.'],
    ['summary', 'synthetic-routes-daily-report', '합성 오늘의 보고서예요.'],
    ['visit', 'synthetic-routes-appointment', '합성 건강 기록을 진료에서 확인할까요?'],
  ];
  for (const [kind, id, prose] of reports) {
    assert.ok(helper.includes(`("${kind}:${id}", "${prose}")`), id);
    assert.ok(fixture.includes(id) && fixture.includes(prose), id);
  }
  const ordered = (steps) => {
    let after = 0;
    for (const step of steps) {
      const index = helper.indexOf(step, after);
      assert.ok(index >= after, `Missing or out-of-order route assertion: ${step}`);
      after = index + step.length;
    }
  };
  // The direct Records child has an internal list Back and a separate native route Back.
  ordered([
    'openTab(app, "records", markers: ["records-title"])',
    'XCTAssertFalse(browser.exists)',
    'app.buttons["records-open-generated-reports"]',
    'try tap(open, in: app)',
    'route(app, markers: ["generated-report-browser"])',
    'for (key, text) in reports {',
    'try tap(row, in: app)',
    '"generated-report-detail"',
    'prose(prose, expected: text, in: app)',
    'assertReadOnly(app)',
    'app.buttons["generated-report-back"]',
    'XCTAssertEqual(back.label, "목록으로")',
    'try tap(back, in: app, towardTop: true)',
    'XCTAssertFalse(UITestConditions.element(app, "generated-report-detail").exists)',
    'XCTAssertTrue(UITestConditions.exists(row))',
    'tapNavigation(app, "navigation-back")',
    'route(app, markers: ["records-title"])',
    'XCTAssertFalse(browser.exists)',
    '"navigation-tab-records"',
    'XCTAssertTrue(records.isSelected)',
    'openTab(app, "overview", markers: ["overview-title", "overview-next-appointment-clinic"])',
    'tap(UITestConditions.element(app, "overview-prepare-visit"), in: app)',
    '"visit-day-questions"',
    'app.staticTexts["visit-day-question-synthetic-routes-question"]',
    `question.label.contains("${reports[3][2]}")`,
    'XCTAssertTrue(question.isHittable)',
    'assertReadOnly(app)',
    'tapNavigation(app, "navigation-back")',
    'try revealOverviewTitle(app)',
    'openTab(app, "conversation", markers: ["rag-conversation-screen"])',
  ]);
  assert.match(fixture, /questionId: 'synthetic-routes-question'/);
  assert.match(fixture, /appointmentId: 'synthetic-routes-appointment'/);
  assert.match(fixture, /id: ids\.questionId,[\s\S]*appointmentId: appointment\.id,/);
  assert.match(helper, /for id in .*"inference-disclosure-sheet".*\{\s*XCTAssertFalse/);
  assert.match(
    helper,
    /XCTAssertFalse\(UITestConditions.element\(app, "rag-conversation-sessions-toggle"\).exists\)/,
  );
  assert.match(body, /for dark in \[false, true\]/);
  assert.match(body, /UICTContentSizeCategoryAccessibilityXXXL/);
  assert.doesNotMatch(body, /navigation-tab-schedule|openTab\(app, "schedule"/);
  assert.match(source, /records-open-schedule/);
  assert.match(source, /schedule\.isEnabled && schedule\.isHittable/);
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
