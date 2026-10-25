import UIKit
import XCTest

@MainActor
enum FormUITestConditions {
    /// React Native backs multiline TextInput with UITextView; query that role instead of scanning every accessibility element.
    static func multilineInput(_ app: XCUIApplication, identifier: String) -> XCUIElement {
        app.textViews.matching(identifier: identifier).firstMatch
    }

    /// AX can mark a covered control hittable. Require its full frame above the keyboard and floating navigation controls.
    /// Noninteractive text callers must prove rendered visibility separately when opting out of hit testing.
    @discardableResult
    static func reveal(_ target: XCUIElement, in app: XCUIApplication, scrollID: String, towardTop: Bool = false, horizontalPosition: CGFloat = 0.5, requireHittable: Bool = true, maximumScrollFraction: CGFloat = 0.45, avoiding: XCUIElement? = nil, observeFocusGesture: ((String, CGRect?) -> Void)? = nil) -> CGRect? {
        let scroll = UITestConditions.element(app, scrollID)
        return reveal(target, in: app, scroll: scroll, towardTop: towardTop, horizontalPosition: horizontalPosition, requireHittable: requireHittable, maximumScrollFraction: maximumScrollFraction, avoiding: avoiding, observeFocusGesture: observeFocusGesture)
    }

    /// Nested footer content has a smaller native ScrollView than its tagged outer container. Callers can supply that observed viewport without changing existing tagged-scroll callers.
    @discardableResult
    static func reveal(_ target: XCUIElement, in app: XCUIApplication, scroll: XCUIElement, towardTop: Bool = false, horizontalPosition: CGFloat = 0.5, requireHittable: Bool = true, maximumScrollFraction: CGFloat = 0.45, focusedKeyboardFrame: CGRect? = nil, referenceSize: CGSize? = nil, avoiding: XCUIElement? = nil, observeFocusGesture: ((String, CGRect?) -> Void)? = nil) -> CGRect? {
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
            let usableScroll = unobstructedScrollFrame(scrollFrame, target: targetFrame, in: app)
            guard let geometry = FormScrollGeometry(application: applicationFrame, scroll: usableScroll, keyboard: keyboardFrame, reservedKeyboard: focusedKeyboardFrame) else {
                XCTFail("The form has no finite visible viewport: application=\(applicationFrame), scroll=\(scrollFrame), keyboard=\(String(describing: keyboardFrame))")
                return nil
            }
            if let targetFrame, geometry.contains(targetFrame, referenceSize: referenceSize), !requireHittable || target.isHittable {
                // Reuse this exact successful observation if focus later clips the AX frame.
                return targetFrame
            }
            if attempt == 16 {
                observeFocusGesture?("reveal-exhausted", focusedKeyboardFrame)
                break
            }
            let position: CGFloat?
            let excludedFrame = avoiding.map(\.frame)
            if let excludedFrame {
                // A post-edit button can be covered while the drag origin lies inside its wider editor.
                // Reobserve that known editor after each gesture; its own scrolling must not consume the form drag.
                lastObservation += ", excluded=\(excludedFrame)"
                position = geometry.horizontalPosition(outside: excludedFrame)
            } else {
                position = focusedKeyboardFrame == nil ? horizontalPosition : targetFrame.flatMap { geometry.horizontalPosition(outside: $0) }
            }
            guard let position, let gesture = geometry.gesture(target: targetFrame, towardTop: towardTop, horizontalPosition: position, maximumScrollFraction: maximumScrollFraction, verticalBounds: excludedFrame) else {
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
                // Observe the same reserved boundary around the existing gesture, without changing its coordinates or budget.
                observeFocusGesture?("before-scroll-\(attempt + 1)", focusedKeyboardFrame)
                start.press(forDuration: 0.05, thenDragTo: end, withVelocity: velocity, thenHoldForDuration: 0)
                observeFocusGesture?("after-scroll-\(attempt + 1)", focusedKeyboardFrame)
            }
        }
        XCTFail("Control did not enter the measured form viewport: \(lastObservation)")
        return nil
    }

    static func replace(_ input: XCUIElement, with text: String, in app: XCUIApplication, scrollID: String, observeCursorTap: ((String) -> Void)? = nil, observeFocusGesture: ((String, CGRect?) -> Void)? = nil) {
        let replaceStartedAt = ProcessInfo.processInfo.systemUptime
        defer { recordTiming("replace-total", since: replaceStartedAt) }
        // Pass measured closures as explicit arguments so Swift binds `else` to each guard statement.
        guard let reference = measure("reveal", { reveal(input, in: app, scrollID: scrollID, observeFocusGesture: observeFocusGesture) }) else { return }
        let current = measure("value-read") { input.value as? String ?? "" }
        observeFocusGesture?("before-focus-tap", nil)
        measure("field-tap") { input.tap() }
        observeFocusGesture?("after-focus-tap", nil)
        guard let focused = measure("focused-input", {
            exposeFocusedInput(input, referenceSize: reference.size, in: app, scrollID: scrollID, observeFocusGesture: observeFocusGesture)
        }) else { return }
        let shouldReplace = if current.isEmpty {
            false
        } else {
            measure("placeholder-read") { current != input.placeholderValue }
        }
        if shouldReplace {
            // Default activation placed the caret at the start in hosted traces. Touch the lower trailing
            // interior of the independently observed input for these short, visible fixture contents.
            // This is not a document-end operation for internally scrolled text; exact-empty must reject a missed end.
            let point = measure("caret-placement") {
                CGVector(dx: focused.input.minX + focused.input.width * 0.95 - focused.application.minX,
                         dy: focused.input.minY + focused.input.height * 0.95 - focused.application.minY)
            }
            // Optional journal diagnostics observe this existing tap without changing its coordinates or recovery behavior.
            observeCursorTap?("before")
            let tapPoint = CGPoint(x: focused.application.minX + point.dx, y: focused.application.minY + point.dy)
            guard !navigationControlFrames(app).contains(where: { $0.contains(tapPoint) }) else {
                XCTFail("The cursor tap must not be covered by a floating navigation control: \(tapPoint)")
                return
            }
            measure("caret-tap") { app.coordinate(withNormalizedOffset: .zero).withOffset(point).tap() }
            observeCursorTap?("after")
            // Controlled fields can drop batched backspaces while rerendering.
            // Send one delete key through the focused app instead of re-resolving the input query per Character.
            // exact-empty below remains the only outcome check; do not retry a missed deletion.
            measure("delete-existing") {
                for _ in current {
                    app.typeText(XCUIKeyboardKey.delete.rawValue)
                }
            }
            measure("exact-empty") { exactValue(input, equals: "") }
        }
        if !text.isEmpty {
            // Controlled fields can drop batched input, so preserve per-character synchronization.
            // Type through the app's focused control to avoid resolving this changing field query per Character.
            // The exact-value assertion below remains the sole outcome check; no corrective edit follows.
            measure("type-characters") {
                for character in text {
                    app.typeText(String(character))
                }
            }
        }
        measure("exact-value") { exactValue(input, equals: text) }
    }

    /// Keep timing diagnostic-only; step names and durations exclude field text and identifiers.
    private static func measure<T>(_ step: String, _ operation: () -> T) -> T {
        let startedAt = ProcessInfo.processInfo.systemUptime
        defer { recordTiming(step, since: startedAt) }
        return operation()
    }

    private static func recordTiming(_ step: String, since startedAt: TimeInterval) {
        let elapsedMs = Int(((ProcessInfo.processInfo.systemUptime - startedAt) * 1000).rounded())
        print("OROT_FORM_UI_TIMING {\"step\":\"\(step)\",\"elapsedMs\":\(elapsedMs)}")
    }

    /// Native navigation buttons consume touches while their transparent gaps pass through to the form.
    private static func navigationControlFrames(_ app: XCUIApplication) -> [CGRect] {
        let bar = UITestConditions.element(app, "navigation-action-bar-overlay")
        guard bar.exists else { return [] }
        return bar.descendants(matching: .button).allElementsBoundByIndex
            .filter { $0.exists && $0.isHittable }.map(\.frame)
    }

    /// Bottom content padding permits scrolling past the floating bar; it does not make covered input pixels readable.
    private static func unobstructedScrollFrame(_ scroll: CGRect, target: CGRect?, in app: XCUIApplication) -> CGRect {
        var usable = scroll
        for control in navigationControlFrames(app) where control.intersects(scroll) {
            if let target, control.maxX <= target.minX || control.minX >= target.maxX {
                continue
            }
            usable.size.height = max(0, min(usable.maxY, control.minY) - usable.minY)
        }
        return usable
    }

    /// Focus can clip the AX frame. Keep the earlier observed height, reserve the observed occlusion, then independently verify the refocused input.
    private static func exposeFocusedInput(_ input: XCUIElement, referenceSize: CGSize, in app: XCUIApplication, scrollID: String, observeFocusGesture: ((String, CGRect?) -> Void)?) -> (application: CGRect, input: CGRect)? {
        let keyboard = app.keyboards.firstMatch
        // A hardware keyboard can leave no software keyboard. Observe presence without waiting for one to appear.
        let keyboardFrame = keyboard.exists ? keyboard.frame : nil
        let scroll = UITestConditions.element(app, scrollID)
        let applicationFrame = app.frame
        let scrollFrame = scroll.frame
        let inputFrame = input.frame
        let usableScroll = unobstructedScrollFrame(scrollFrame, target: inputFrame, in: app)
        guard let geometry = FormScrollGeometry(application: applicationFrame, scroll: usableScroll, keyboard: keyboardFrame) else {
            XCTFail("The focused input has no finite keyboard viewport")
            return nil
        }
        // Record the frames already queried by containment, without another AX read or private input value.
        // Native activity timestamps pair these observations with the existing test video if editing fails.
        XCTContext.runActivity(named: "Focused form viewport: application=\(applicationFrame), scroll=\(scrollFrame), keyboard=\(String(describing: keyboardFrame)), input=\(String(describing: inputFrame)), viewport=\(geometry.viewport), referenceSize=\(referenceSize)") { _ in }
        if !geometry.contains(inputFrame, referenceSize: referenceSize) {
            let reservation = keyboardFrame.flatMap { geometry.keyboardReservation($0, for: inputFrame, referenceSize: referenceSize) }
            guard keyboardFrame == nil || reservation != nil else {
                XCTFail("The focused input has no finite occlusion boundary")
                return nil
            }
            // Dragging can dismiss the keyboard. Keep its observed space until refocus; a clipped slice cannot finish the reveal.
            guard reveal(input, in: app, scroll: scroll, towardTop: inputFrame.minY <= geometry.viewport.minY, focusedKeyboardFrame: reservation, referenceSize: referenceSize, observeFocusGesture: observeFocusGesture) != nil else { return nil }
            observeFocusGesture?("before-refocus-tap", reservation)
            input.tap()
            observeFocusGesture?("after-refocus-tap", reservation)
        }
        // A reserved frame is only a scroll constraint, never evidence that the refocused editor is currently visible.
        let actualKeyboardFrame = keyboard.exists ? keyboard.frame : nil
        let actualApplicationFrame = app.frame
        let actualScrollFrame = scroll.frame
        let actualInputFrame = input.frame
        let actualUsableScroll = unobstructedScrollFrame(actualScrollFrame, target: actualInputFrame, in: app)
        guard let actual = FormScrollGeometry(application: actualApplicationFrame, scroll: actualUsableScroll, keyboard: actualKeyboardFrame) else {
            XCTFail("The refocused input has no finite keyboard viewport")
            return nil
        }
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
