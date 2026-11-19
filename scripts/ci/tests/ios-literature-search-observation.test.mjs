import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = 'apps/mobile/ios/OrotUITests/';
const journey = readFileSync(`${root}SummaryAndLiteratureUITests.swift`, 'utf8');
const helper = readFileSync(`${root}LiteratureConsentUITestConditions.swift`, 'utf8').split(
  'enum LiteratureSearchObservation {',
)[1];

test('synthetic search observations bracket the unchanged single taps before existing waits', () => {
  for (const phase of ['initial', 'approved']) {
    const before = journey.indexOf(`phase: "${phase}-before"`);
    const after = journey.indexOf(`phase: "${phase}-after"`);
    assert.ok(before >= 0 && after > before);
    const interval = journey.slice(before, after);
    assert.equal(interval.match(/node\(app, "external-evidence-search"\)\.tap\(\)/g)?.length, 1);
    assert.doesNotMatch(interval, /wait\(|exists\(|sleep\(|scroll|dismiss/i);
  }
  assert.ok(
    journey.indexOf('phase: "approved-after"') <
      journey.indexOf('XCTAssertTrue(UITestConditions.exists(title))'),
  );
});

test('receipt is content-free point observation, not another readiness or pass gate', () => {
  assert.ok(helper);
  for (const field of [
    'buttonMatches=',
    'expectedQueryMatches=',
    'transportCount=',
    'keyboardOverlap=',
    'contained=',
    'loading=',
    'results=',
    'consentRequired=',
    'unavailable=',
  ]) {
    assert.ok(helper.includes(field), field);
  }
  assert.doesNotMatch(
    helper,
    /\.tap\(|XCTAssert|wait\(|sleep\(|debugDescription|screenshot\(|terminate\(|activate\(/,
  );
  assert.match(helper, /Int\(UITestConditions.text\(counter\)\)/);
  assert.match(helper, /value as\? String == "sleep synthetic"/);
  assert.doesNotMatch(helper, /\\\(.*(?:query\.value|counter\.label|counter\.value)/);
});
