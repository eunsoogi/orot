import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('scalar traces preserve ordering, error isolation, gates and bounded output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-input-observer-'));
  try {
    writeFileSync(
      join(directory, 'main.swift'),
      String.raw`import Foundation
@main struct Control {
  @MainActor static func main() throws {
    let run = UUID()
    let suite = "encounter-observation-" + UUID().uuidString
    let defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }
    precondition(EncounterInputGate.session(defaults: defaults) == nil)
    defaults.set("private-recording-id", forKey: "OROT_TEST_ENCOUNTER_INPUT_OBSERVATION")
    precondition(EncounterInputGate.session(defaults: defaults) == nil)
    defaults.set(run.uuidString, forKey: "OROT_TEST_ENCOUNTER_INPUT_OBSERVATION")
    precondition(EncounterInputGate.session(defaults: defaults) == run)
    defaults.set("invalid", forKey: "OROT_TEST_FORM_OBSERVATION")
    precondition(EncounterInputGate.session(defaults: defaults) == run)
    defaults.set(UUID().uuidString, forKey: "OROT_TEST_FORM_OBSERVATION")
    precondition(EncounterInputGate.session(defaults: defaults) == nil)
    defaults.removeObject(forKey: "OROT_TEST_ENCOUNTER_INPUT_OBSERVATION")
    precondition(EncounterInputGate.session(defaults: defaults) == nil)
    var records: [EncounterInputTrace.Record] = []
    let trace = EncounterInputTrace(run: run) { records.append($0) }
    let selected = EncounterInputTrace.Target(matches: 1, truncated: false, length: 12, location: 0,
      selectionLength: 12, focused: true, keyWindow: true)
    let empty = EncounterInputTrace.Target(matches: 1, truncated: false, length: 0, location: 0,
      selectionLength: 0, focused: true, keyWindow: true)
    trace.append(.beforePress, step: 1, target: selected)
    trace.append(.textChanged, step: 2, target: empty)
    trace.append(.afterPress, step: 1, target: empty)
    trace.append(.reactReceipt, step: 3, target: empty, reactEvent: .changeText, reactSequence: 1, reactLength: 0)
    precondition(records.map(\.sequence) == [1,2,3,4])
    precondition(records.map(\.step) == [1,2,1,3])
    precondition(records.allSatisfy { $0.run == run })
    precondition(zip(records, records.dropFirst()).allSatisfy { $0.uptime <= $1.uptime })
    let data = try JSONEncoder().encode(records)
    let decoded = try JSONSerialization.jsonObject(with: data) as! [[String: Any]]
    precondition(Set(decoded[0].keys) == Set(["run","sequence","step","uptime","phase","target"]))
    precondition(Set((decoded[0]["target"] as! [String: Any]).keys) == Set(["matches","truncated","length","location","selectionLength","focused","keyWindow"]))
    precondition(!String(decoding: data, as: UTF8.self).contains("private-recording-id"))
    let failure = NSError(domain: "private-health-error", code: 7)
    var attempts = 0
    let throwing = EncounterInputTrace(run: run) { _ in attempts += 1; throw failure }
    throwing.append(.beforePress, step: 1, target: selected)
    throwing.append(.afterPress, step: 1, target: empty)
    precondition(attempts == 2)
    for index in 5...4100 { trace.append(.textChanged, step: index, target: empty) }
    precondition(records.count == 4096)
    var runner: [EncounterInputObservation.Record] = []
    let bracket = EncounterInputObservation(run: run) { runner.append($0) }
    bracket.record(.beforeSelect); bracket.record(.afterSelect)
    bracket.record(.beforeDelete); bracket.record(.afterDelete)
    precondition(runner.map(\.step) == [1,2,3,4])
    precondition(runner.allSatisfy { $0.run == run })
    let broken = EncounterInputObservation(run: run) { _ in throw failure }
    broken.record(.beforeSelect); broken.record(.afterSelect)
    print("scalar-controls-pass")
  }
}`,
    );
    const binary = join(directory, 'control');
    execFileSync(
      'swiftc',
      [
        '-swift-version',
        '6',
        '-warnings-as-errors',
        '-parse-as-library',
        'apps/mobile/ios/OrotMobile/EncounterInputTrace.swift',
        'apps/mobile/ios/OrotUITests/EncounterInputObservation.swift',
        join(directory, 'main.swift'),
        '-o',
        binary,
      ],
      { timeout: 60000 },
    );
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

test('the original replace body performs identical actions and assertions with absent or failing observation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-input-parity-'));
  try {
    const form = readFileSync('apps/mobile/ios/OrotUITests/FormUITestConditions.swift', 'utf8');
    const body = form.slice(
      form.indexOf('    static func replace('),
      form.indexOf('    /// Native navigation'),
    );
    // Only external UI dependencies are doubled; the real replace/measure/timing bodies execute unchanged.
    writeFileSync(
      join(directory, 'main.swift'),
      String.raw`import Foundation
#if canImport(CoreGraphics)
import CoreGraphics
#endif
enum Flags { case command }
enum XCUIKeyboardKey: String { case delete = "DELETE" }
final class XCUIElement {
  var value: Any? = "prior"
  let placeholderValue: String? = nil
  var actions: [String] = []
  func tap() { actions.append("tap") }
}
final class XCUIApplication {
  let input: XCUIElement
  let deletes: Bool
  init(_ input: XCUIElement, deletes: Bool) { self.input = input; self.deletes = deletes }
  func typeKey(_ key: String, modifierFlags: Flags) { input.actions.append("select") }
  func typeText(_ text: String) {
    if text == XCUIKeyboardKey.delete.rawValue {
      input.actions.append("delete")
      if deletes { input.value = "" }
    } else {
      input.actions.append("type")
      input.value = (input.value as? String ?? "") + text
    }
  }
}
enum Helpers {
  static func reveal(_ input: XCUIElement, in app: XCUIApplication, scrollID: String,
    observeFocusGesture: ((String, CGRect?) -> Void)?) -> CGRect? {
    input.actions.append("reveal")
    return CGRect(x: 0, y: 0, width: 100, height: 100)
  }
  static func exposeFocusedInput(_ input: XCUIElement, referenceSize: CGSize, in app: XCUIApplication,
    scrollID: String, observeFocusGesture: ((String, CGRect?) -> Void)?, stopAfterFirstFocusDrag: Bool) -> CGRect? {
    input.actions.append("focus")
    return CGRect(x: 0, y: 0, width: 100, height: 100)
  }
  static func exactValue(_ input: XCUIElement, equals text: String) -> Bool {
    input.actions.append(text.isEmpty ? "assert-empty" : "assert-value")
    return input.value as? String == text
  }
` +
        body +
        String.raw`
}
func run(_ observe: Bool, deletes: Bool, scrollID: String) -> ([String], Bool, String) {
  let input = XCUIElement()
  let app = XCUIApplication(input, deletes: deletes)
  let failing = EncounterInputObservation { _ in throw NSError(domain: "private-observer-error", code: 1) }
  let result = Helpers.replace(input, with: "ab", in: app, scrollID: scrollID,
    observeInput: observe ? failing.record : nil)
  return (input.actions, result, input.value as? String ?? "")
}
for deletes in [true, false] {
  for scroll in ["navigation-route-scroll", "symptoms-scroll"] {
    let absent = run(false, deletes: deletes, scrollID: scroll)
    let observed = run(true, deletes: deletes, scrollID: scroll)
    precondition(absent.0 == observed.0 && absent.1 == observed.1 && absent.2 == observed.2)
    if deletes {
      precondition(absent.0 == ["reveal", "tap", "focus", "select", "delete", "assert-empty", "type", "type", "assert-value"])
      precondition(absent.1 && absent.2 == "ab")
    } else if scroll == "navigation-route-scroll" {
      precondition(absent.0.suffix(3) == ["type", "type", "assert-value"])
      precondition(!absent.1 && absent.2 == "priorab")
    } else {
      precondition(absent.0.last == "assert-empty" && !absent.1 && absent.2 == "prior")
    }
  }
}
print("original-action-parity-pass")
`,
    );
    const binary = join(directory, 'control');
    execFileSync(
      'swiftc',
      [
        '-swift-version',
        '6',
        '-warnings-as-errors',
        'apps/mobile/ios/OrotUITests/EncounterInputObservation.swift',
        join(directory, 'main.swift'),
        '-o',
        binary,
      ],
      { timeout: 60000 },
    );
    const output = execFileSync(binary, [], { encoding: 'utf8', timeout: 10000 });
    assert.match(output, /original-action-parity-pass/);
    assert.equal(output.includes('private-observer-error'), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
