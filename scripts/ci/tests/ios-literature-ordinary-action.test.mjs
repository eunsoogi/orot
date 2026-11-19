import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// This source contract protects the native observation, not actual UIKit hit delivery.
test('ordinary literature opening requires measured dock clearance before tapping', () => {
  const source = readFileSync(
    'apps/mobile/ios/OrotUITests/SummaryAndLiteratureUITests.swift',
    'utf8',
  );
  const ordinary = source.slice(
    source.indexOf('let open = node(app, "external-evidence-open-selected-source")'),
    source.indexOf('// Compare the same supplied title'),
  );
  const reveal = ordinary.indexOf('try LiteratureActionReveal.reveal(open, in: app, dock: search)');
  const tap = ordinary.indexOf('open.tap()');
  assert.ok(
    reveal >= 0 && reveal < tap,
    'isHittable alone must not admit a dock-overlapped action',
  );
  for (const assertion of [
    'XCTAssertTrue(app.frame.contains(open.frame))',
    'XCTAssertLessThanOrEqual(open.frame.maxY, search.frame.minY - 16)',
    'XCTAssertTrue(open.isHittable',
    'XCTAssertGreaterThanOrEqual(open.frame.height, 44)',
  ]) {
    const position = ordinary.indexOf(assertion);
    assert.ok(position > reveal && position < tap, assertion);
  }
  assert.doesNotMatch(ordinary, /UITestConditions\.scrollTo\(open, in: app\)/);
  assert.ok(ordinary.includes('synthetic-article-opened'));
  assert.ok(ordinary.includes('literature-recovered-'));
  assert.ok(ordinary.includes('literature-cancelled-'));
  const largeText = source.slice(source.indexOf('// Compare the same supplied title'));
  assert.ok(largeText.includes('LiteratureActionReveal.reveal(open, in: app, dock: search)'));
  assert.ok(largeText.includes('open.frame.height, 44'));
  assert.ok(largeText.includes('row.frame.height, defaultTitleHeight'));
});
