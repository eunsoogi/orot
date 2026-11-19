import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const directory = 'apps/mobile/ios/OrotUITests/';
const geometry = readFileSync(`${directory}NavigationGeometryUITestConditions.swift`, 'utf8');
const extension = `${directory}NavigationRootBoundaryUITestConditions.swift`;
const source = existsSync(extension) ? readFileSync(extension, 'utf8') : geometry;
const journey = readFileSync(`${directory}RootNavigationUITests.swift`, 'utf8');

// Compare the native oracle to independently maintained product destinations.
// This source contract does not replace native rail geometry or hit delivery.
test('right rail measures precisely the four actual root destinations', () => {
  const product = readFileSync('apps/mobile/src/navigation/rootTabs.ts', 'utf8');
  const expected = [...product.matchAll(/id: '([^']+)'/g)].map((match) => match[1]);
  const roots = source.slice(source.indexOf('let roots ='), source.indexOf('var homeFrame:'));
  const actual = [...roots.matchAll(/\("([a-z]+)", \[/g)].map((match) => match[1]);
  assert.deepEqual(expected, ['conversation', 'overview', 'records', 'settings']);
  assert.deepEqual(actual, expected);
  assert.ok(source.includes('right-rail-native-geometry'));
  for (const assertion of [
    'XCTAssertTrue(selected.isSelected)',
    'XCTAssertEqual(indicator.width, indicator.height, accuracy: 0.5)',
    'XCTAssertEqual(indicator.midX, selected.frame.midX, accuracy: 0.5)',
    'XCTAssertEqual(indicator.midY, selected.frame.midY, accuracy: 0.5)',
    'panelSnapshot(app, frames: ["selection": indicator, "selectedControl": selected.frame]',
  ])
    assert.ok(source.includes(assertion), assertion);
});

test('Schedule retains Records selection and measured boundary, then returns through its real section', () => {
  const start = source.indexOf('static func verifyScheduleSectionBoundary');
  assert.ok(start >= 0);
  const section = source.slice(start);
  const ordered = [
    'openTab(app, "records", markers: ["records-title"])',
    '"records-section-schedule"',
    'schedule.tap()',
    'route(app, markers: ["calendar-title", "schedule-retry"])',
    'XCTAssertTrue(schedule.isSelected)',
    'verifyRootSelection(app, tab: "records", testCase: testCase)',
    'navigationID: "navigation-tab-records", name: "duo-schedule-section-boundary"',
    'assertSameRailCenter(rootFrame, contextualFrames: [scheduleFrame])',
    '"records-section-records"',
    'records.tap()',
    'route(app, markers: ["records-title"])',
    'XCTAssertTrue(records.isSelected)',
  ];
  let previous = -1;
  for (const value of ordered) {
    const index = section.indexOf(value);
    assert.ok(index > previous, value);
    previous = index;
  }
  assert.doesNotMatch(section, /navigation-back|navigation-tab-schedule|sleep\(|timeout:/);
  assert.ok(
    source.includes(
      'verifyScheduleSectionBoundary(app, rootFrame: XCTUnwrap(homeFrame), testCase: testCase)',
    ),
  );
  const project = readFileSync('apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj', 'utf8');
  assert.equal(
    (project.match(/NavigationRootBoundaryUITestConditions.swift in Sources/g) ?? []).length,
    2,
  );
});

test('original Recording contextual rail and Back guards remain independent of the section check', () => {
  const rail = journey.slice(
    journey.indexOf('func testRightRail'),
    journey.indexOf('/// The original rail'),
  );
  for (const value of [
    'verifyRootBoundaries(app, testCase: self)',
    'XCTAssertEqual(home.control.label, "한눈에 탭")',
    'XCTAssertEqual(home.toolbar.frame.width, 48, accuracy: 0.5)',
    'tap(app, "records-new-recording")',
    'captureRecordingBoundary(app, testCase: self)',
    'assertSameRailCenter(rootFrame, contextualFrames: contextualFrames)',
    'XCTAssertEqual(back.toolbar.frame.width, 48, accuracy: 0.5)',
    'XCTAssertEqual(back.control.label, "이전 화면으로 돌아가기")',
    'XCTAssertFalse(app.buttons["navigation-home"].exists)',
    'tapNavigation(app, "navigation-back")',
    'route(app, markers: ["records-title"])',
  ])
    assert.ok(rail.includes(value), value);
});

test('Recording boundary waits for the actual fullscreen route without weakening geometry', () => {
  const geometry = readFileSync(
    'apps/mobile/ios/OrotUITests/NavigationGeometryUITestConditions.swift',
    'utf8',
  );
  const helper = geometry.slice(
    geometry.indexOf('static func captureRecordingBoundary'),
    geometry.indexOf('/// Measure child viewports'),
  );
  const product = readFileSync('apps/mobile/src/recording/RecordingControls.tsx', 'utf8');
  assert.ok(product.includes('testID="recording-controls-fullscreen"'));
  assert.ok(helper.includes('route(app, markers: ["recording-controls-fullscreen"])'));
  assert.ok(
    helper.includes(
      'return try captureBoundary(app, navigationID: "navigation-back", name: "recording-content-boundary", testCase: testCase)',
    ),
  );
  assert.ok(!helper.includes('recording-controls-scroll'));
  assert.ok(!helper.includes('timeout'));
  assert.equal((journey.match(/captureRecordingBoundary\(app, testCase: self\)/g) ?? []).length, 2);
});
