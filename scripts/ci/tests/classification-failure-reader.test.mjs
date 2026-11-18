import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

const swift = readFileSync(
  'apps/mobile/ios/OrotUITests/DisclosureLayoutUITestObservations.swift',
  'utf8',
);
const source = readFileSync(
  'apps/mobile/src/medicalAppointments/classificationTextPagination.ts',
  'utf8',
);
const { paginateClassificationLines } = await import(
  'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64')
);
// Execute the native reader's exact pattern, not a separately maintained approximation of the message.
const pattern = new RegExp(swift.match(/static let messagePattern = #"([^\n]+)"#/)[1]);
const reason = '이 요청의 AI 처리 승인이 필요해요.';
const message = `1번째 묶음 처리 중 0초 후 중단됐어요. ${reason} 완료한 분류는 유지했어요.`;
const normalize = (value) => value.replace(/\s/g, '');
const accepted = (pages, expected = reason) => {
  const result = pattern.exec(normalize(pages.join('')));
  return result !== null && result[1] === normalize(expected);
};

function nativePages(text, height) {
  // Synthetic native line measurements deliberately split inside the formerly contiguous category string.
  const lines = Array.from(text.matchAll(/.{1,13}/gu), (match) => ({ text: match[0], height: 26 }));
  return paginateClassificationLines(lines, height);
}

test('old contiguous-label predicate rejects the same complete native-line-broken document', () => {
  const pages = nativePages(message, 1000);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].includes(reason), false);
  assert.equal(normalize(pages.join('')), normalize(message));
  assert.equal(accepted(pages), true);
});

test('real paginator preserves the complete summary over multiple pages and reader pattern accepts it', () => {
  const pages = nativePages(message, 52);
  assert.ok(pages.length > 1);
  assert.ok(pages.every((page) => !page.includes(reason)));
  assert.equal(normalize(pages.join('')), normalize(message));
  assert.equal(accepted(pages), true);
  assert.equal(accepted(nativePages(message.replace('0초', '123초'), 26)), true);
  const providerReason = '선택한 AI의 응답을 받지 못했어요.';
  assert.equal(
    accepted(nativePages(message.replace(reason, providerReason), 52), providerReason),
    true,
  );
});

test('missing pages, changed category, prefix, timing or preserved-results suffix still fail', () => {
  const pages = nativePages(message, 26);
  assert.equal(accepted(pages.slice(1)), false);
  assert.equal(accepted(pages.slice(0, -1)), false);
  assert.equal(accepted([...pages.slice(0, 2), ...pages.slice(3)]), false);
  assert.equal(accepted([...pages, pages.at(-1)]), false);
  for (const changed of [
    message.replace(reason, '선택한 AI의 응답을 받지 못했어요.'),
    message.replace('1번째', '2번째'),
    message.replace('0초', '알수없음초'),
    message.replace('0초', '-1초'),
    message.replace('완료한 분류는 유지했어요.', ''),
    message + '추가 임의 문구',
  ])
    assert.equal(accepted(nativePages(changed, 52)), false, changed);
});

test('native reader remains scoped, bounded and diagnostic while original safety assertions stay present', () => {
  assert.match(
    swift,
    /results\.descendants\(matching: \.any\)\.matching\(identifier: "classification-page-text"\)/,
  );
  assert.match(swift, /guard count == 1/);
  assert.match(swift, /guard previous.exists, !previous.isEnabled/);
  assert.match(swift, /for index in 0 \.\.< 256/);
  assert.match(swift, /if !next\.isEnabled/);
  assert.match(swift, /seen\.insert\(text\)\.inserted/);
  assert.match(swift, /contains\(target\.frame\)/);
  assert.match(swift, /record\["type"\]/);
  assert.match(swift, /record\["label"\]/);
  assert.match(swift, /record\["value"\]/);
  assert.match(swift, /XCTWaiter\.wait\(for: \[changed\], timeout: 10\)/);
  const original = readFileSync(
    'apps/mobile/ios/OrotUITests/AppointmentConsentUITests.swift',
    'utf8',
  );
  assert.match(original, /syntheticProviderCalls=1/);
  assert.match(original, /syntheticHealthIncluded=true;syntheticIdentifierExcluded=true/);
  assert.match(
    original,
    /XCTAssertFalse\(node\(app, "calendar-classification-synthetic-calendar-save"\)\.exists\)/,
  );
  assert.match(original, /waitForWidthChange\(page, from: compactWidth\)/);
});
