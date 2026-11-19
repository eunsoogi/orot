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
