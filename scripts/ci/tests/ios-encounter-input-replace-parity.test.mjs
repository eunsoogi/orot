import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

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
// The parity harness compiles the real replace body without XCUITest; this recording stub keeps its opt-in menu branch type-checkable and observable.
enum AppointmentTextSelectionUITestConditions {
  static func selectAll(_ input: XCUIElement, in app: XCUIApplication,
    measure: (_ step: String, _ operation: () -> Void) -> Void) -> Bool {
    measure("select-existing") { input.actions.append("native-select-all") }
    return true
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
