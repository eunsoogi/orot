import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('apps/mobile/ios/OrotUITests/RootNavigationUITests.swift', 'utf8');

test('only the original right-rail case opts into real appearance preparation', () => {
  const rail = source.slice(
    source.indexOf('    func testRightRail'),
    source.indexOf('    /// The original rail'),
  );
  assert.ok(rail.includes('let app = try launchRightRailWithAppearance()'));
  assert.equal((source.match(/try launchRightRailWithAppearance\(\)/g) ?? []).length, 1);
  assert.ok(rail.includes('defer { app.terminate() }'));
});

test('rail preparation preserves configured state and explicitly selects and saves before navigation', () => {
  const helper = source.slice(
    source.indexOf('    private func launchRightRailWithAppearance'),
    source.indexOf('    func testLargeText'),
  );
  for (const expected of [
    'conversation.exists || onboarding.exists',
    'if !conversation.exists {',
    'matching(identifier: "별")',
    'guard star.exists, star.isHittable',
    'FormUITestConditions.reveal(save, in: app, scrollID: "assistant-appearance-scroll")',
    'save.isEnabled, save.isHittable',
    'XCTAssertFalse(onboarding.exists)',
  ])
    assert.ok(helper.includes(expected), expected);
  const ordered = [
    'app.launch()',
    'if !conversation.exists {',
    'star.tap()',
    'save.tap()',
    'NavigationUITestConditions.route(app, markers: ["rag-conversation-screen"])',
    'try NavigationUITestConditions.openTab(app, "overview", markers: ["overview-title"])',
    'return app',
  ];
  let previous = -1;
  for (const token of ordered) {
    const position = helper.indexOf(token);
    assert.ok(position > previous, token);
    previous = position;
  }
  assert.doesNotMatch(helper, /UserDefaults|Keychain|OROT_TEST_ASSISTANT_APPEARANCE|sleep\(/);
  assert.equal((helper.match(/throw NSError/g) ?? []).length, 3);
  assert.equal((helper.match(/addTeardownBlock \{ app\.terminate\(\) \}/g) ?? []).length, 1);
  assert.ok(helper.indexOf('addTeardownBlock') < helper.indexOf('app.launch()'));
});
