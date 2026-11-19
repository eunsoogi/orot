import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('both appearance saves require a measured reveal and retain the native journey', () => {
  const source = readFileSync(
    'apps/mobile/ios/OrotUITests/AssistantAppearanceUITests.swift',
    'utf8',
  );
  const reveal =
    'guard FormUITestConditions.reveal(save, in: app, scrollID: "assistant-appearance-scroll") != nil else { return }';
  const firstSave = source.indexOf(reveal);
  const editedName = source.indexOf(
    'guard waitForName(name, equals: "Momo Companion Long Name") else { return }',
  );
  const secondSave = source.indexOf(reveal, firstSave + reveal.length);
  assert.ok(firstSave >= 0 && firstSave < editedName && editedName < secondSave);
  const initialCheck = source.indexOf(
    'XCTAssertTrue(save.isHittable && save.isEnabled)',
    firstSave,
  );
  const initialTap = source.indexOf('save.tap()', firstSave);
  const editedCheck = source.indexOf('guard save.isHittable, save.isEnabled', secondSave);
  const editedTap = source.indexOf('save.tap()', secondSave);
  assert.ok(firstSave < initialCheck && initialCheck < initialTap && initialTap < editedName);
  assert.ok(secondSave < editedCheck && editedCheck < editedTap);
  assert.doesNotMatch(source, /appearanceScroll\.swipeUp\(\)/);
  assert.equal((source.match(/save\.tap\(\)/g) ?? []).length, 2);
  assert.match(source, /save\.isHittable && save\.isEnabled/);
  assert.match(source, /guard save\.isHittable, save\.isEnabled/);
  assert.match(source, /waitForVisibleKeyboard\(in: app\)/);
  assert.match(source, /star\.value as\? String\)\?\.contains\("checked"\)/);
  assert.match(source, /XCTAssertFalse\(\(star\.value as\? String\)\?\.contains\("unchecked"\)/);
  assert.match(source, /app\.terminate\(\)\s+app\.launch\(\)/);
  assert.match(source, /Momo Companion Long Name, 비서 꾸미기/);
  assert.equal((source.match(/assertFloatingIdentity\(identity, in: app\)/g) ?? []).length, 3);
});
