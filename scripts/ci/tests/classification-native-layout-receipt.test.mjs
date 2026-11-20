import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { stripTypeScriptTypes } from 'node:module';
const swift = readFileSync('apps/mobile/ios/OrotUITests/ClassificationStagesUITests.swift', 'utf8');
const owner = readFileSync('apps/mobile/ios/OrotUITests/FormWindowOwnership.swift', 'utf8');
const entry = readFileSync('apps/mobile/e2e/ClassificationProbeScreen.tsx', 'utf8');
test('existing staged journey samples actual geometry without replacing its oracles', () => {
  assert.match(entry, /onPress=\{layout\.request\}/);
  for (const stage of ['confirmation', 'progress-\\(percent)', 'result-\\(pages.count)'])
    assert.ok(swift.includes(`captureStageLayout(app, stage: "${stage}", anchor: anchor`));
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
  assert.match(owner, /contentSizeCategory/);
  const scene = swift.indexOf(
    'try settleReaderScene(app, session: sceneSession, hostID: "medical-appointment-fullscreen")',
  );
  assert.ok(
    scene > 0 && scene < swift.indexOf('ClassificationConsentUITestSupport.openSettingsChoice'),
  );
  assert.match(swift, /environment\["OROT_CLASSIFICATION_WIDE_STAGE_VALIDATION"\] == "YES"/);
  assert.match(owner, /XCTAssertGreaterThan\(frame.width, frame.height/);
  assert.match(owner, /UIContentSizeCategory\.accessibilityExtraExtraExtraLarge\.rawValue/);
  assert.match(entry, /staged && defaultWideStage && !scenePreparationEnded/);
  assert.match(entry, /<ClassificationReaderSceneControl \/>/);
  assert.match(entry, /if \(staged && defaultWideStage\) setScenePreparationEnded\(true\)/);
  assert.match(owner, /safeAreaInsets/);
  assert.doesNotMatch(
    swift + owner,
    /UICTContentSizeCategory|preferredContentSizeCategory|simctl|sleep\(/,
  );
  const baseline = swift.indexOf(
    'captureStageLayout(app, stage: "confirmation-before-settings", settled: settled)',
  );
  assert.ok(
    scene < baseline &&
      baseline < swift.indexOf('ClassificationConsentUITestSupport.openSettingsChoice'),
  );
  assert.match(owner, /let scopedIDs = required \+ \[markerID, counterID\]/);
  const firstOwner = owner.indexOf('required: scopedIDs)');
  const tap = owner.indexOf('counter.tap()');
  const responseOwner = owner.indexOf('required: scopedIDs)', firstOwner + 1);
  const read = owner.indexOf('UITestConditions.text(scoped(owner, markerID))');
  assert.ok(firstOwner > 0 && firstOwner < tap && tap < responseOwner && responseOwner < read);
  assert.match(owner, /stableStageFrame\(owner.frame, frame\)/);
  assert.match(owner, /actions.append\("medical-appointment-select-provider"\)/);
  assert.match(owner, /XCTAssertEqual\(current.windowID, anchor.windowID\)/);
  assert.match(owner, /XCTAssertEqual\(current.sceneID, anchor.sceneID\)/);
  assert.match(owner, /FormScrollGeometry.stableStageFrame\(target.frame, observed\)/);
  assert.match(owner, /total.allSatisfy\(\{ \$0 == 1 \}\)/);
  assert.doesNotMatch(owner, /app.windows.firstMatch|XCTAssertEqual\(app.windows.count, 1\)/);
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
        windowID: 'view-12',
        sceneID: 'view-9',
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
  assert.equal(result.windowID, 'view-12');
  assert.equal(result.sceneID, 'view-9');
  assert.ok(!JSON.stringify(result).includes('private'));
});
test('missing observations remain missing, never assumed Duo or XXXL', () => {
  assert.equal(classificationLayoutFields(undefined).contentSizeCategory, null);
  assert.deepEqual(classificationLayoutFields({}).windowBounds, {});
  const missing = classificationLayoutFields({
    windowGeometry: { dockControls: { windowID: 'view-0', sceneID: 'private label' } },
  });
  assert.equal(missing.windowID, null);
  assert.equal(missing.sceneID, null);
  assert.deepEqual(
    classificationLayoutFields({
      windowGeometry: { windowBounds: { width: Infinity, height: '647' } },
    }).windowBounds,
    {},
  );
});

test('staged receipt opts into the existing identity-gated native window traits', () => {
  const bridge = readFileSync('apps/mobile/ios/OrotMobile/TestControl.swift', 'utf8');
  const native = readFileSync(
    'apps/mobile/ios/OrotMobile/NavigationGeometryTestObservation.swift',
    'utf8',
  );
  const flag = bridge.match(
    /NavigationGeometryTestObservation\.snapshot\(identity: UserDefaults\.standard\.string\(forKey: "([^"]+)"\) == "YES"/,
  )[1];
  assert.equal(flag, 'OROT_TEST_NAVIGATION_FOCUS_OBSERVATION');
  assert.ok(native.includes('guard let identity else { return geometrySnapshot(identity: nil) }'));
  assert.ok(native.includes('result["dockControls"] ='));
  const launch = swift.slice(
    swift.indexOf('let fixture = ClassificationConsentUITestSupport.launch'),
    swift.indexOf('defer { ClassificationConsentUITestSupport.cleanup'),
  );
  assert.ok(
    launch.includes(`"-${flag}", "YES"`),
    'the scalar receipt requires the existing native identity opt-in',
  );
  const support = readFileSync(
    'apps/mobile/ios/OrotUITests/DisclosureLayoutUITestObservations.swift',
    'utf8',
  );
  assert.ok(!support.includes(flag), 'do not enable this opt-in for unrelated fixture launches');
  for (const guard of [
    'XCTUnwrap(report["dockSampleStartedAtMs"] as? Double)',
    'XCTAssertGreaterThanOrEqual(dockStarted, ended)',
    'XCTAssertEqual(report["visibleKeyWindowCount"] as? Int, 1)',
  ])
    assert.ok(owner.includes(guard));
});
