import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('scalar traces preserve ordering, error isolation, gates and bounded output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-input-observer-'));
  try {
    const binary = join(directory, 'control');
    const controlSource = 'scripts/ci/tests/fixtures/ios-encounter-input-observation-control.swift';
    const compilerPath = execFileSync('which', ['swiftc'], { encoding: 'utf8' }).trim();
    const compilerVersion = execFileSync('swiftc', ['--version'], { encoding: 'utf8' }).trim();
    const compilerArgs = [
      '-v',
      '-D',
      'OROT_TESTS',
      '-swift-version',
      '6',
      '-warnings-as-errors',
      '-parse-as-library',
      'apps/mobile/ios/OrotMobile/EncounterInputTrace.swift',
      'apps/mobile/ios/OrotMobile/VisitQuestionInputGate.swift',
      'apps/mobile/ios/OrotUITests/EncounterInputObservation.swift',
      controlSource,
      '-o',
      binary,
    ];
    // Keep the 60-second limit and expose host/compiler context only after failure.
    try {
      execFileSync('swiftc', compilerArgs, { timeout: 60000 });
    } catch (error) {
      console.error(
        JSON.stringify(
          {
            compilerPath,
            compilerVersion,
            runnerImageVersion: process.env.ImageVersion || 'unavailable',
            error: error.message,
            stdout: error.stdout?.toString('utf8') ?? '',
            stderr: error.stderr?.toString('utf8') ?? '',
          },
          null,
          2,
        ),
      );
      throw error;
    }
    const output = execFileSync(binary, [], { encoding: 'utf8', timeout: 10000 });
    assert.match(output, /scalar-controls-pass/);
    assert.match(output, /OROT_ENCOUNTER_INPUT_OVERFLOW/);
    assert.equal(output.includes('private-health-error'), false);
    const window = readFileSync(
      'apps/mobile/ios/OrotMobile/EncounterInputObservationWindow.swift',
      'utf8',
    );
    assert.equal(window.match(/super\.sendEvent\(event\)/g)?.length, 1);
    assert.equal(
      /\.hitTest\(|addGestureRecognizer|becomeFirstResponder|setSelected|observeValue|delegate\s*=/.test(
        window,
      ),
      false,
    );
    assert.match(window, /textDidChangeNotification/);
    assert.match(window, /event\.type == \.presses/);
    assert.match(window, /inputs\.count == 1/);
    assert.ok(window.includes('"encounter-text-candidate-0"'));
    assert.equal(window.includes('"next-visit-question-text-0"'), false);
    assert.match(window, /current\.accessibilityIdentifier == "encounter-text-candidate-0"/);
    const questionWindow = readFileSync(
      'apps/mobile/ios/OrotMobile/VisitQuestionInputObservationWindow.swift',
      'utf8',
    );
    assert.match(
      questionWindow,
      /current\.accessibilityIdentifier == "next-visit-question-text-0"/,
    );
    assert.match(questionWindow, /private weak var identifiedInput: UITextView\?/);
    assert.match(questionWindow, /input\?\.text\.utf16\.count/);
    assert.match(questionWindow, /input\?\.selectedRange/);
    assert.match(questionWindow, /input\?\.isFirstResponder/);
    assert.match(questionWindow, /inputs\.count == 1/);
    assert.match(questionWindow, /windowID: windowID/);
    assert.match(questionWindow, /override var accessibilityValue/);
    assert.match(questionWindow, /publicUIKitSnapshot/);
    assert.match(questionWindow, /accessibilityIdentifier = "visit-question-input-observation"/);
    assert.match(questionWindow, /isUserInteractionEnabled = false/);
    assert.match(questionWindow, /trace\.append\(\.publicUIKitRead/);
    assert.match(questionWindow, /recentEvents: trace\.bufferedEvents/);
    assert.match(questionWindow, /eventBufferTruncated: trace\.bufferedEventsTruncated/);
    const visitGate = readFileSync(
      'apps/mobile/ios/OrotMobile/VisitQuestionInputGate.swift',
      'utf8',
    );
    assert.match(visitGate, /OROT_TEST_VISIT_QUESTION_INPUT_OBSERVATION/);
    assert.match(visitGate, /OROT_TEST_SCENARIO.*ai-feature-visit-questions/);
    assert.match(visitGate, /OROT_EVIDENCE_SOURCE_DUO_VISUAL_STATE.*synthetic/);
    const appDelegate = readFileSync('apps/mobile/ios/OrotMobile/AppDelegate.swift', 'utf8');
    assert.match(
      appDelegate,
      /else if let run = VisitQuestionInputGate\.session\(\) \{\s+window = VisitQuestionInputObservationWindow/,
    );
    const questionJourney = readFileSync(
      'apps/mobile/ios/OrotUITests/WindowGeometryUITests.swift',
      'utf8',
    );
    assert.match(
      questionJourney,
      /ProcessInfo\.processInfo\.environment\["OROT_TEST_VISIT_QUESTION_INPUT_OBSERVATION"\] == "1"/,
    );
    assert.match(
      questionJourney,
      /launchArguments \+= \["-OROT_TEST_VISIT_QUESTION_INPUT_OBSERVATION", inputObservation\.run\.uuidString\]/,
    );
    assert.match(questionJourney, /observeInput: inputObservation\.map/);
    const visitRunner = readFileSync(
      'apps/mobile/ios/OrotUITests/EncounterInputObservation.swift',
      'utf8',
    );
    assert.match(visitRunner, /func captureUIKit\(/);
    assert.match(visitRunner, /visit-question-input-observation/);
    assert.match(visitRunner, /XCTAttachment\(data:/);
    assert.match(visitRunner, /runMatches/);
    assert.match(visitRunner, /struct UIKitSnapshot: Codable/);
    assert.match(visitRunner, /recentEvents: \[NativeEvent\]/);
    assert.match(visitRunner, /eventBufferTruncated: Bool/);
    assert.match(visitRunner, /JSONDecoder\(\)\.decode\(UIKitSnapshot\.self/);
    assert.match(visitRunner, /snapshotStatus: status/);
    assert.match(visitRunner, /testCase\.add\(attachment\)/);
    assert.equal(visitRunner.includes('최근 증상 변화를 어떻게 정리할까요?'), false);
    assert.match(
      questionJourney,
      /observeInput: inputObservation\.map \{ observation in[\s\S]+captureUIKit\(phase, app: app, testCase: self\)/,
    );
    const delegate = readFileSync('apps/mobile/ios/OrotMobile/AppDelegate.swift', 'utf8');
    assert.match(
      delegate,
      /if let launch = HealthReviewObservationWindow.session\(\)[\s\S]+else if let run = EncounterInputGate.session\(\)/,
    );
    const runner = readFileSync('apps/mobile/ios/OrotUITests/EncounterReviewUITests.swift', 'utf8');
    assert.match(
      runner,
      /observeInput && ProcessInfo.processInfo.environment\["OROT_TEST_ENCOUNTER_INPUT_OBSERVATION"\] == "1"/,
    );
    assert.equal(runner.match(/observeInput: true/g)?.length, 1);
    const form = readFileSync('apps/mobile/ios/OrotUITests/FormUITestConditions.swift', 'utf8');
    assert.match(form, /app\.typeKey\("a", modifierFlags: \.command\)/);
    assert.match(form, /app\.typeText\(XCUIKeyboardKey.delete.rawValue\)/);
    assert.match(form, /guard emptied \|\| scrollID != "symptoms-scroll" else \{ return false \}/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
