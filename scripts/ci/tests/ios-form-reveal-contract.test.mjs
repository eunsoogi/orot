import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('shared form reveal uses one bounded drag path and fails closed outside the viewport', () => {
  const form = readFileSync('apps/mobile/ios/OrotUITests/FormUITestConditions.swift', 'utf8');
  assert.equal(
    form.match(
      /start\.press\(forDuration: 0\.05, thenDragTo: end, withVelocity: velocity, thenHoldForDuration: 0\)/g,
    )?.length,
    1,
  );
  assert.match(form, /for attempt in 0 \.\.\. 16/);
  assert.match(form, /XCTFail\("Control did not enter the measured form viewport:/);
});
