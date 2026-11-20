import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../../apps/mobile/ios/', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('both App-backed Routes cases prepare appearance before route assertions, not the standalone probe', () => {
  const source = read('OrotUITests/AiFeatureNavigationUITests.swift');
  const cases = source.split('    func test').slice(1, 4);
  assert.equal(cases.length, 3);
  for (const body of cases.slice(0, 2)) {
    const launch = body.indexOf('app.launch()');
    const prepare = body.indexOf('try RoutesAppearanceUITestConditions.prepare(app)');
    const firstRoute = body.search(
      /try NavigationUITestConditions.openTab|XCTAssertTrue\(UITestConditions.exists\(node\(app, "rag-conversation-screen"/,
    );
    assert.ok(launch >= 0 && prepare > launch && firstRoute > prepare);
    assert.ok(body.includes('"ai-feature-visit-questions"'));
  }
  assert.ok(cases[2].includes('"evidence-visual"'));
  assert.ok(!cases[2].includes('RoutesAppearanceUITestConditions.prepare'));
});

test('explicit preparation preserves configured state and uses real choice, enabled Save, and committed route', () => {
  const helper = read('OrotUITests/RoutesAppearanceUITestConditions.swift');
  for (const expected of [
    'conversation.exists || onboarding.exists',
    'if !conversation.exists {',
    'UITestConditions.element(app, "assistant-appearance-avatar-star")',
    'XCTAssertEqual(star.label, "별")',
    'star.tap()',
    'guard save.isEnabled, save.isHittable',
    'save.tap()',
    'guard UITestConditions.exists(conversation)',
    'XCTAssertFalse(onboarding.exists',
  ]) {
    assert.ok(helper.includes(expected), expected);
  }
  assert.ok(helper.indexOf('star.tap()') < helper.indexOf('save.tap()'));
  assert.ok(
    helper.indexOf('save.tap()') < helper.indexOf('guard UITestConditions.exists(conversation)'),
  );
  assert.equal((helper.match(/FormUITestConditions.reveal/g) ?? []).length, 2);
  assert.ok(!/UserDefaults|Keychain|inference-disclosure-allow|sleep\(/.test(helper));
  const project = read('OrotMobile.xcodeproj/project.pbxproj');
  assert.equal((project.match(/RoutesAppearanceUITestConditions.swift/g) ?? []).length, 6);
});

test('first Routes case reaches Send through current Records surfaces and preserves recovery', () => {
  const source = read('OrotUITests/AiFeatureNavigationUITests.swift');
  const body = source.split('    func test')[1];
  assert.match(body, /recording-controls-fullscreen/);
  assert.match(body, /recording-session-panel/);
  assert.match(body, /records-section-schedule/);
  assert.match(body, /XCTAssertFalse\(node\(app, "navigation-tab-schedule"\).exists\)/);
  assert.doesNotMatch(
    body,
    /navigationAction\(app, "navigation-tab-schedule"|openTab\(app, "schedule"|recording-controls-scroll/,
  );
  const send = body.indexOf('send.tap()');
  const draftCapture = body.indexOf('let unsentDraft =');
  const clearError = body.indexOf('XCTAssertFalse(node(app, "rag-conversation-error").exists)');
  assert.ok(draftCapture >= 0 && draftCapture < clearError && clearError < send);
  const failure = '대화 기록이나 선택한 AI를 확인하지 못해 전송하지 않았어요. 다시 보내 주세요.';
  const firstFailure = body.indexOf(failure);
  const retainedFailure = body.indexOf(failure, firstFailure + failure.length);
  assert.ok(send >= 0 && firstFailure > send && retainedFailure > firstFailure);
  assert.equal((body.match(/identifier: "rag-conversation-error"/g) ?? []).length, 2);
  assert.equal(
    (body.match(/XCTAssertEqual\(input\.value as\? String, unsentDraft\)/g) ?? []).length,
    2,
  );
  assert.equal(
    (body.match(/XCTAssertFalse\(node\(app, "conversation-message-body"\)\.exists\)/g) ?? [])
      .length,
    2,
  );
  assert.ok(body.indexOf('try openSchedule(app)') > retainedFailure);
  assert.match(body, /XCTAssertFalse\(node\(app, "calendar-connect"\).exists\)/);
});

test('only the first Routes journey checks native composer and failure text against the floating dock', () => {
  const body = read('OrotUITests/AiFeatureNavigationUITests.swift').split('    func test')[1];
  assert.equal(
    (body.match(/RoutesVisibleContentUITestConditions\.conversationControl/g) ?? []).length,
    2,
  );
  assert.equal(
    (body.match(/RoutesVisibleContentUITestConditions\.conversationMessage/g) ?? []).length,
    2,
  );
  assert.doesNotMatch(body, /ConversationComposerDockUITestConditions\.assertReachable/);
  const helper = read('OrotUITests/RoutesVisibleContentUITestConditions.swift');
  const dock = helper.slice(helper.indexOf('private static func conversationBounds'));
  assert.match(dock, /FormWindowOwnership.resolve\(app, scroll: history, target: floating\)/);
  assert.match(
    dock,
    /unobstructedScrollFrame\(historyFrame.intersection\(windowFrame\).*controls: clipping\)/,
  );
  assert.match(dock, /\[overlay, keyboardFrame\]/);
  assert.match(dock, /bounds\.dock\.contains\(frame\) && bounds\.overlay\.contains\(frame\)/);
  assert.match(dock, /control\.isEnabled && control\.isHittable/);
  assert.match(dock, /frame\.maxY, keyboard\.minY/);
  assert.match(dock, /frame\.intersects\(back\.frame\)/);
  assert.match(dock, /XCTWaiter\.wait\(for: \[ready\], timeout: 12\)/);
});

test('the Settings return uses the visible root row, selected tab and dismissed child', () => {
  const body = read('OrotUITests/AiFeatureNavigationUITests.swift').split('    func test')[1];
  const root = body.indexOf(
    'try RoutesVisibleContentUITestConditions.settingsRootAfterProviderBack(in: app)',
  );
  const back = body.lastIndexOf(
    'try NavigationUITestConditions.tapNavigation(app, "navigation-back")',
    root,
  );
  const conversation = body.indexOf(
    'try NavigationUITestConditions.openTab(app, "conversation"',
    root,
  );
  assert.ok(back >= 0 && root > back && conversation > root);
  assert.match(body.slice(0, back), /openTab\(app, "settings", markers: \["settings-title"\]\)/);
  assert.doesNotMatch(body.slice(back, root), /"settings-title"/);
  const helper = read('OrotUITests/RoutesVisibleContentUITestConditions.swift').split(
    'static func settingsRootAfterProviderBack',
  )[1];
  for (const marker of [
    'settings-open-provider',
    'navigation-tab-settings',
    'settings-provider-screen',
  ]) {
    assert.ok(helper.includes(marker), marker);
  }
  assert.match(helper, /element\.isHittable/);
  assert.match(helper, /viewport\.intersects\(frame\)/);
  assert.match(helper, /visibleRows\.count == 1 && selectedTabs\.count == 1/);
  assert.match(helper, /visible\(\$0\) && \$0\.isSelected/);
  assert.match(helper, /!childScreens\.allElementsBoundByIndex\.contains\(where: visible\)/);
  assert.match(helper, /XCTWaiter\.wait\(for: \[ready\], timeout: 12\)/);
  assert.doesNotMatch(helper, /\.tap\(|\.swipe\w*\(|FormUITestConditions\.reveal/);
});
