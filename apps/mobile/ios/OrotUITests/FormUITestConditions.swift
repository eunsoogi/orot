import UIKit
import XCTest

@MainActor
enum FormUITestConditions {
    /// AX can mark a keyboard-covered control hittable. Require its measured frame inside the visible scroller before touching it.
    /// Noninteractive text callers must prove rendered visibility separately when opting out of hit testing.
    static func reveal(_ target: XCUIElement, in app: XCUIApplication, scrollID: String, towardTop: Bool = false, horizontalPosition: CGFloat = 0.5, requireHittable: Bool = true, maximumScrollFraction: CGFloat = 0.45) {
        let scroll = UITestConditions.element(app, scrollID)
        reveal(target, in: app, scroll: scroll, towardTop: towardTop, horizontalPosition: horizontalPosition, requireHittable: requireHittable, maximumScrollFraction: maximumScrollFraction)
    }

    /// Nested footer content has a smaller native ScrollView than its tagged outer container. Callers can supply that observed viewport without changing existing tagged-scroll callers.
    static func reveal(_ target: XCUIElement, in app: XCUIApplication, scroll: XCUIElement, towardTop: Bool = false, horizontalPosition: CGFloat = 0.5, requireHittable: Bool = true, maximumScrollFraction: CGFloat = 0.45) {
        XCTAssertTrue(UITestConditions.exists(scroll))
        var lastObservation = ""
        // Observe the last scroll too; otherwise a control revealed by the final allowed gesture is reported missing.
        for attempt in 0 ... 16 {
            let keyboard = app.keyboards.firstMatch
            // AX queries are independent. Read each frame once and fail before synthesizing an invalid gesture.
            let applicationFrame = app.frame
            let scrollFrame = scroll.frame
            let keyboardFrame = keyboard.exists ? keyboard.frame : nil
            let targetFrame = target.exists ? target.frame : nil
            lastObservation = "target=\(String(describing: targetFrame)), scroll=\(scrollFrame), application=\(applicationFrame), keyboard=\(String(describing: keyboardFrame))"
            guard let geometry = FormScrollGeometry(application: applicationFrame, scroll: scrollFrame, keyboard: keyboardFrame) else {
                XCTFail("The form has no finite visible viewport: application=\(applicationFrame), scroll=\(scrollFrame), keyboard=\(String(describing: keyboardFrame))")
                return
            }
            if let targetFrame, geometry.contains(targetFrame), !requireHittable || target.isHittable {
                return
            }
            if attempt == 16 {
                break
            }
            guard let gesture = geometry.gesture(target: targetFrame, towardTop: towardTop, horizontalPosition: horizontalPosition, maximumScrollFraction: maximumScrollFraction) else {
                XCTFail("The form gesture has invalid coordinates")
                return
            }
            // Anchor to the observed application window, so XCTest cannot re-resolve a disappearing scroller as the coordinate origin.
            let origin = app.coordinate(withNormalizedOffset: .zero)
            let start = origin.withOffset(gesture.start)
            let end = origin.withOffset(gesture.end)
            // Default-speed short drags can move a tall row beyond the opposite edge. Use slow movement only
            // once the target intersects the viewport; keep fast travel, containment, hit testing and the gesture budget.
            let velocity: XCUIGestureVelocity = targetFrame.map { geometry.viewport.intersects($0) } == true ? .slow : .default
            XCTContext.runActivity(named: "Measured form scroll \(attempt + 1): \(lastObservation)") { _ in
                start.press(forDuration: 0.05, thenDragTo: end, withVelocity: velocity, thenHoldForDuration: 0)
            }
        }
        XCTFail("Control did not enter the measured form viewport: \(lastObservation)")
    }

    static func replace(_ input: XCUIElement, with text: String, in app: XCUIApplication, scrollID: String) {
        reveal(input, in: app, scrollID: scrollID)
        input.tap()
        let current = input.value as? String ?? ""
        // Keep replacement on the real focused editor; the contextual menu can omit Select All
        // after long-press selection and never expose another page.
        // Do not read another app's clipboard: the owned fixture Simulator clears this value after the action.
        defer {
            if !text.isEmpty {
                UIPasteboard.general.string = nil
            }
        }
        if !text.isEmpty {
            UIPasteboard.general.string = text
        }
        if !current.isEmpty, current != input.placeholderValue {
            input.typeKey("a", modifierFlags: .command)
            if text.isEmpty {
                input.typeText(XCUIKeyboardKey.delete.rawValue)
            }
        }
        if !text.isEmpty {
            // XCTest synthesizes iOS keyboard commands, so UIKit performs selection and paste.
            // Exact readback below still rejects insertion, missed focus or incomplete replacement.
            input.typeKey("v", modifierFlags: .command)
        }
        exactValue(input, equals: text)
    }

    private static func exactValue(_ input: XCUIElement, equals text: String) {
        let matches = {
            let value = input.value as? String ?? ""
            return value == text || (text.isEmpty && value == input.placeholderValue)
        }
        // Avoid the expectation's initial polling interval when the observed value already matches.
        if matches() {
            return
        }
        let exact = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in matches() }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [exact]), .completed, input.debugDescription)
    }
}
