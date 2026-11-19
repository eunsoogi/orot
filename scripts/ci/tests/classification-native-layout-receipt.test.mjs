import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { stripTypeScriptTypes } from 'node:module';
const swift = readFileSync('apps/mobile/ios/OrotUITests/ClassificationStagesUITests.swift', 'utf8');
const entry = readFileSync('apps/mobile/e2e/ClassificationProbeScreen.tsx', 'utf8');
test('existing staged journey samples actual geometry without replacing its oracles', () => {
  assert.match(entry, /onPress=\{layout\.request\}/);
  for (const stage of ['confirmation', 'progress-\\(percent)', 'result-\\(pages.count)'])
    assert.ok(swift.includes(`captureStageLayout(app, stage: "${stage}")`));
  for (const oracle of [
    'percent: 0, calls: 1',
    'percent: 88, calls: 2',
    'percent: 100, calls: 2',
    'pages.dropLast().reversed()',
    'Every segment of the long synthetic title',
    'for index in 2 ... 9',
    'XCTAssertGreaterThanOrEqual(action.frame.height, 44)',
    'XCTAssertTrue(action.isHittable)',
  ])
    assert.ok(swift.includes(oracle));
  assert.match(swift, /contentSizeCategory/);
  assert.match(swift, /safeAreaInsets/);
  assert.doesNotMatch(swift, /UICTContentSizeCategory|preferredContentSizeCategory|simctl|sleep\(/);
});

const receiptSource = readFileSync('apps/mobile/e2e/classificationLayoutReceipt.tsx', 'utf8');
const pureSource = receiptSource.slice(
  receiptSource.indexOf('export function classificationLayoutFields'),
  receiptSource.indexOf('/** Explicit taps'),
);
const { classificationLayoutFields } = await import(
  'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(pureSource)).toString('base64')
);
test('receipt preserves actual native dimensions and category but discards unrelated payload', () => {
  const result = classificationLayoutFields({
    windowGeometry: {
      windowBounds: { x: 0, y: 0, width: 429, height: 647, privateText: 'secret' },
      safeAreaInsets: { top: 57, right: 0, bottom: 34, left: 0 },
      sampleStartedAtMs: 101,
      sampleEndedAtMs: 102,
      dockControls: {
        contentSizeCategory: 'UICTContentSizeCategoryAccessibilityXXXL',
        visibleKeyWindowCount: 1,
        windowFrameInScreen: { x: 0, y: 0, width: 429, height: 647 },
        controls: ['private'],
      },
      transcript: 'private',
    },
  });
  assert.equal(result.windowBounds.width, 429);
  assert.equal(result.contentSizeCategory, 'UICTContentSizeCategoryAccessibilityXXXL');
  assert.equal(result.safeAreaInsets.bottom, 34);
  assert.equal(result.sampleStartedAtMs, 101);
  assert.ok(!JSON.stringify(result).includes('private'));
});
test('missing observations remain missing, never assumed Duo or XXXL', () => {
  assert.equal(classificationLayoutFields(undefined).contentSizeCategory, null);
  assert.deepEqual(classificationLayoutFields({}).windowBounds, {});
  assert.deepEqual(
    classificationLayoutFields({
      windowGeometry: { windowBounds: { width: Infinity, height: '647' } },
    }).windowBounds,
    {},
  );
});
