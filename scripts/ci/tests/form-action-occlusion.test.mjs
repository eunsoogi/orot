import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../../apps/mobile/ios/OrotUITests/', import.meta.url);
const source = (name) => readFileSync(new URL(name, root), 'utf8');

test('form reveal and both focused checks apply measured action-button exclusions', () => {
  const helper = source('FormUITestConditions.swift');
  // This guards the real helper wiring; native geometry assertions remain in the registered Swift test.
  assert.ok(
    helper.includes(
      'unobstructedScrollFrame(scrollFrame, target: targetFrame, in: app, excluding: target.exists ? target.identifier : nil)',
    ),
  );
  assert.ok(
    helper.includes(
      'unobstructedScrollFrame(scrollFrame, target: inputFrame, in: app, excluding: input.identifier)',
    ),
  );
  assert.ok(
    helper.includes(
      'unobstructedScrollFrame(actualScrollFrame, target: actualInputFrame, in: app, excluding: input.identifier)',
    ),
  );
  assert.equal((helper.match(/scroll: unobstructedFrame/g) ?? []).length, 2);
  assert.ok(helper.includes('scroll: actualUnobstructedFrame'));
  assert.ok(helper.includes('controls ?? navigationControlFrames(app, excluding: identifier)'));
  assert.ok(
    helper.includes(
      '.filter { $0.exists && $0.isHittable && (identifier == nil || identifier?.isEmpty == true || $0.identifier != identifier) }.map(\\.frame)',
    ),
  );
  assert.ok(helper.includes('FormScrollGeometry.unobstructedScrollFrame(scroll, target: target'));
});

test('registered geometry regression retains occlusion, transparent-gap, keyboard and shifted-window checks', () => {
  const regression = source('FormScrollGeometryUITests.swift');
  for (const expected of [
    'try FormScrollGeometryRegression.verify()',
    'try verifyActionDockOcclusion()',
    'XCTAssertFalse(geometry.contains(movedEditor))',
    'XCTAssertLessThan(drag.end.dy, drag.start.dy)',
    'controls: [beside]), scroll)',
    'controls: []), scroll)',
    'XCTAssertEqual(focused.viewport.maxY, 590)',
  ]) {
    assert.ok(regression.includes(expected), expected);
  }
});
