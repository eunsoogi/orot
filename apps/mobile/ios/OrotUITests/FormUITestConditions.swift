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
        let replaceStartedAt = ProcessInfo.processInfo.systemUptime
        defer { recordTiming("replace-total", since: replaceStartedAt) }
        measure("reveal") { reveal(input, in: app, scrollID: scrollID) }
        measure("field-tap") { input.tap() }
        let current = measure("value-read") { input.value as? String ?? "" }
        let shouldSelectAll = if current.isEmpty {
            false
        } else {
            measure("placeholder-read") {
                current != input.placeholderValue
            }
        }
        // Populate the synthetic clipboard before opening the menu so Paste is present even on an empty editor.
        // Do not read another app's clipboard: the owned fixture Simulator clears this value after the action.
        defer {
            if !text.isEmpty {
                measure("clipboard-clear") { UIPasteboard.general.string = nil }
            }
        }
        if !text.isEmpty {
            measure("clipboard-write") { UIPasteboard.general.string = text }
        }
        if shouldSelectAll {
            measure("select-all-long-press") { input.press(forDuration: 1) }
            let selectAll = measure("select-all-menu-wait") { editMenuItem(app, "Select All") }
            measure("select-all-tap") { selectAll.tap() }
            if text.isEmpty {
                measure("delete") { input.typeText(XCUIKeyboardKey.delete.rawValue) }
            }
        } else if !text.isEmpty {
            measure("paste-long-press") { input.press(forDuration: 1) }
        }
        if !text.isEmpty {
            // One native paste event avoids controlled-input character loss and per-key XCTest idling on a cold hosted runner.
            // Select All keeps the native edit menu and selection. Paste replaces that selection directly,
            // avoiding a delete event and a second long press that add no editor boundary.
            let paste = measure("paste-menu-wait") { editMenuItem(app, "Paste") }
            measure("paste-tap") { paste.tap() }
        }
        measure("exact-value") { exactValue(input, equals: text) }
    }

    /// Keep form timing diagnostic-only and free of field text, identifiers, placeholders, or clipboard contents.
    private static func measure<T>(_ step: String, _ operation: () -> T) -> T {
        let startedAt = ProcessInfo.processInfo.systemUptime
        defer { recordTiming(step, since: startedAt) }
        return operation()
    }

    private static func recordTiming(_ step: String, since startedAt: TimeInterval) {
        let elapsedMs = Int(((ProcessInfo.processInfo.systemUptime - startedAt) * 1000).rounded())
        print("OROT_FORM_UI_TIMING {\"step\":\"\(step)\",\"elapsedMs\":\(elapsedMs)}")
    }

    private static func editMenuItem(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        let menuItem = app.menuItems[label]
        let button = app.buttons[label]
        let next = app.buttons["Next Page"]
        // Large text pages menu commands, and UIKit exposes them as either role.
        // Menu presentation can finish after the press returns. Reobserve all three
        // choices until one is actionable instead of binding an absent role forever.
        for page in 0 ... 6 {
            var command: XCUIElement?
            let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                for candidate in [menuItem, button] where candidate.exists && candidate.isHittable {
                    command = candidate
                    return true
                }
                return next.exists && next.isHittable
            }, object: nil)
            guard UITestConditions.wait(for: [ready]) == .completed else {
                XCTFail("Editor menu observation was interrupted")
                return button
            }
            if let command {
                return command
            }
            guard page < 6 else {
                XCTFail("Editor command \(label) was absent after six menu pages")
                return button
            }
            next.tap()
        }
        return button
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
