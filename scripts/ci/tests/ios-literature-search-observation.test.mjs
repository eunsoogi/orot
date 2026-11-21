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

test('the current settings gate approves the explicit Europe PMC disclosure before returning', () => {
  const approve = readFileSync(`${root}LiteratureConsentUITestConditions.swift`, 'utf8').split(
    'enum LiteratureSearchObservation {',
  )[0];
  const previousGate = approve.indexOf('id: "provider-selection-confirm"');
  const recipient = approve.indexOf('XCTAssertEqual(recipientText, "Europe PMC")');
  const guardRecipient = approve.indexOf('guard recipientText == "Europe PMC"');
  const reveal = approve.indexOf(
    'FormUITestConditions.reveal(allow, in: app, scrollID: "inference-disclosure-content")',
  );
  const tap = approve.indexOf('allow.tap()');
  const dismissed = approve.indexOf('MainActor.assumeIsolated { !sheet.exists }');
  const picker = approve.indexOf(
    'XCTAssertTrue(UITestConditions.exists(node("summary-visual-picker")))',
  );
  assert.ok(
    previousGate >= 0 &&
      previousGate < recipient &&
      recipient < guardRecipient &&
      guardRecipient < reveal &&
      reveal < tap &&
      tap < dismissed &&
      dismissed < picker,
  );
  assert.match(approve, /let sheet = node\("inference-disclosure-sheet"\)/);
  assert.match(approve, /let disclosureRecipient = node\("inference-disclosure-recipient"\)/);
  assert.match(approve, /let allow = node\("inference-disclosure-allow"\)/);
  assert.match(approve, /let canApprove = allow\.isHittable && allow\.isEnabled/);
  assert.match(approve, /guard canApprove else \{ return \}/);
  assert.match(
    approve,
    /XCTAssertEqual\(UITestConditions\.wait\(for: \[dismissal\]\), \.completed\)/,
  );
  assert.equal(approve.match(/allow\.tap\(\)/g)?.length, 1);
  assert.equal(approve.match(/"synthetic-literature-search-count"\)\), "0"\)/g)?.length, 2);
});
