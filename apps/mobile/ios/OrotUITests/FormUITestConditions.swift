import UIKit
import XCTest

@MainActor
enum FormUITestConditions {
    /// AX can mark a keyboard-covered control hittable. Require its measured frame inside the visible scroller before touching it.
    /// Noninteractive text callers must prove rendered visibility separately when opting out of hit testing.
    @discardableResult
    static func reveal(_ target: XCUIElement, in app: XCUIApplication, scrollID: String, towardTop: Bool = false, horizontalPosition: CGFloat = 0.5, requireHittable: Bool = true, maximumScrollFraction: CGFloat = 0.45) -> CGRect? {
        let scroll = UITestConditions.element(app, scrollID)
        return reveal(target, in: app, scroll: scroll, towardTop: towardTop, horizontalPosition: horizontalPosition, requireHittable: requireHittable, maximumScrollFraction: maximumScrollFraction)
    }

    /// Nested footer content has a smaller native ScrollView than its tagged outer container. Callers can supply that observed viewport without changing existing tagged-scroll callers.
    @discardableResult
    static func reveal(_ target: XCUIElement, in app: XCUIApplication, scroll: XCUIElement, towardTop: Bool = false, horizontalPosition: CGFloat = 0.5, requireHittable: Bool = true, maximumScrollFraction: CGFloat = 0.45, focusedKeyboardFrame: CGRect? = nil, referenceSize: CGSize? = nil) -> CGRect? {
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
            guard let geometry = FormScrollGeometry(application: applicationFrame, scroll: scrollFrame, keyboard: keyboardFrame, reservedKeyboard: focusedKeyboardFrame) else {
                XCTFail("The form has no finite visible viewport: application=\(applicationFrame), scroll=\(scrollFrame), keyboard=\(String(describing: keyboardFrame))")
                return nil
            }
            if let targetFrame, geometry.contains(targetFrame, referenceSize: referenceSize), !requireHittable || target.isHittable {
                // Reuse this exact successful observation if focus later clips the AX frame.
                return targetFrame
            }
            if attempt == 16 {
                break
            }
            let position = focusedKeyboardFrame == nil ? horizontalPosition : targetFrame.flatMap { geometry.horizontalPosition(outside: $0) }
            guard let position, let gesture = geometry.gesture(target: targetFrame, towardTop: towardTop, horizontalPosition: position, maximumScrollFraction: maximumScrollFraction) else {
                XCTFail("The form gesture has invalid coordinates")
                return nil
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
        return nil
    }

    static func replace(_ input: XCUIElement, with text: String, in app: XCUIApplication, scrollID: String) {
        guard let reference = reveal(input, in: app, scrollID: scrollID) else { return }
        let current = input.value as? String ?? ""
        input.tap()
        guard let focused = exposeFocusedInput(input, referenceSize: reference.size, in: app, scrollID: scrollID) else { return }
        if !current.isEmpty, current != input.placeholderValue {
            // Default activation placed the caret at the start in hosted traces. Touch the lower trailing
            // interior of the independently observed input for these short, visible fixture contents.
            // This is not a document-end operation for internally scrolled text; exact-empty must reject a missed end.
            let point = CGVector(dx: focused.input.minX + focused.input.width * 0.95 - focused.application.minX,
                                 dy: focused.input.minY + focused.input.height * 0.95 - focused.application.minY)
            app.coordinate(withNormalizedOffset: .zero).withOffset(point).tap()
            // The original UTF-16 bound also covers composed text without an unbounded edit loop.
            let deletion = String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.utf16.count)
            input.typeText(deletion)
            exactValue(input, equals: "")
        }
        if !text.isEmpty {
            // A batched native string lost characters in a controlled input. Complete each
            // character action and its app-idleness wait before sending the next edit.
            for character in text {
                input.typeText(String(character))
            }
        }
        exactValue(input, equals: text)
    }

    /// Focus can clip the AX frame. Keep the earlier observed height, reserve the observed occlusion, then independently verify the refocused input.
    private static func exposeFocusedInput(_ input: XCUIElement, referenceSize: CGSize, in app: XCUIApplication, scrollID: String) -> (application: CGRect, input: CGRect)? {
        let keyboard = app.keyboards.firstMatch
        // A hardware keyboard can leave no software keyboard. Observe presence without waiting for one to appear.
        let keyboardFrame = keyboard.exists ? keyboard.frame : nil
        let scroll = UITestConditions.element(app, scrollID)
        let applicationFrame = app.frame
        let scrollFrame = scroll.frame
        guard let geometry = FormScrollGeometry(application: applicationFrame, scroll: scrollFrame, keyboard: keyboardFrame) else {
            XCTFail("The focused input has no finite keyboard viewport")
            return nil
        }
        // Record the frames already queried by containment, without another AX read or private input value.
        // Native activity timestamps pair these observations with the existing test video if editing fails.
        let inputFrame = keyboardFrame.map { _ in input.frame }
        XCTContext.runActivity(named: "Focused form viewport: application=\(applicationFrame), scroll=\(scrollFrame), keyboard=\(String(describing: keyboardFrame)), input=\(String(describing: inputFrame)), viewport=\(geometry.viewport), referenceSize=\(referenceSize)") { _ in }
        if let keyboardFrame, let inputFrame, !geometry.contains(inputFrame, referenceSize: referenceSize) {
            guard let reservation = geometry.keyboardReservation(keyboardFrame, for: inputFrame, referenceSize: referenceSize) else {
                XCTFail("The focused input has no finite occlusion boundary")
                return nil
            }
            // Dragging can dismiss the keyboard. Keep its observed space until refocus; a clipped slice cannot finish the reveal.
            guard reveal(input, in: app, scroll: scroll, towardTop: inputFrame.minY <= geometry.viewport.minY, focusedKeyboardFrame: reservation, referenceSize: referenceSize) != nil else { return nil }
            input.tap()
        }
        // A reserved frame is only a scroll constraint, never evidence that the refocused editor is currently visible.
        let actualKeyboardFrame = keyboard.exists ? keyboard.frame : nil
        let actualApplicationFrame = app.frame
        let actualScrollFrame = scroll.frame
        guard let actual = FormScrollGeometry(application: actualApplicationFrame, scroll: actualScrollFrame, keyboard: actualKeyboardFrame) else {
            XCTFail("The refocused input has no finite keyboard viewport")
            return nil
        }
        let actualInputFrame = input.frame
        let contained = actual.contains(actualInputFrame, referenceSize: referenceSize)
        let hittable = contained && input.isHittable
        XCTContext.runActivity(named: "Refocused form viewport: application=\(actualApplicationFrame), scroll=\(actualScrollFrame), keyboard=\(String(describing: actualKeyboardFrame)), input=\(actualInputFrame), viewport=\(actual.viewport), referenceSize=\(referenceSize), contained=\(contained), hittable=\(hittable)") { _ in }
        guard contained, hittable else {
            XCTFail("The refocused input must fit the actual keyboard viewport before editing")
            return nil
        }
        return (application: actualApplicationFrame, input: actualInputFrame)
    }

    private static func exactValue(_ input: XCUIElement, equals text: String) {
        // Native key synthesis has completed and waited for the app to idle. A missed edit
        // cannot finish later without another action; fail with its actual value instead of polling forever.
        let value = input.value as? String ?? ""
        let observed = text.isEmpty && value == input.placeholderValue ? "" : value
        XCTAssertEqual(observed, text, "The completed native edit must replace the entire input value")
    }
}
