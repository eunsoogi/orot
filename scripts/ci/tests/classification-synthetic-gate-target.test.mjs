import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('synthetic release gate has layout headroom without relaxing the native 44pt oracle', () => {
  const fixture = readFileSync('apps/mobile/e2e/ClassificationProbeScreen.tsx', 'utf8');
  const native = readFileSync(
    'apps/mobile/ios/OrotUITests/ClassificationStagesUITests.swift',
    'utf8',
  );
  assert.match(fixture, /gate: \{ minHeight: 45, justifyContent: 'center' \}/);
  assert.match(fixture, /onPress=\{scenario.release\}/);
  assert.match(fixture, /style=\{styles.gate\}/);
  assert.match(native, /XCTAssertGreaterThanOrEqual\(gate.frame.height, 44\)/);
  assert.match(native, /XCTAssertTrue\(gate.isHittable\)/);
  assert.doesNotMatch(native, /gate.frame.height\s*\+|gate.frame.height.rounded|nextDown|ulp/);
});
