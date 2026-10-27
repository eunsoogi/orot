import UIKit
import XCTest

@MainActor
enum FormUITestConditions {
    /// React Native backs multiline TextInput with UITextView; query that role instead of scanning every accessibility element.
    static func multilineInput(_ app: XCUIApplication, identifier: String) -> XCUIElement {
        app.textViews.matching(identifier: identifier).firstMatch
    }

    /// AX can mark a keyboard-covered control hittable; require measured viewport containment before a tap.
    /// Journal callers also exclude floating navigation buttons; noninteractive text must prove rendered visibility separately.
    @discardableResult
    static func reveal(_ target: XCUIElement, in app: XCUIApplication, scrollID: String, towardTop: Bool = false, horizontalPosition: CGFloat = 0.5, requireHittable: Bool = true, maximumScrollFraction: CGFloat = 0.45, avoiding: XCUIElement? = nil, keyboardMayBeVisible: Bool = true, observeFocusGesture: ((String, CGRect?) -> Void)? = nil, scrollObservation: FormScrollObservation? = nil) -> CGRect? {
        let scroll = UITestConditions.element(app, scrollID)
        return reveal(target, in: app, scroll: scroll, towardTop: towardTop, horizontalPosition: horizontalPosition, requireHittable: requireHittable, maximumScrollFraction: maximumScrollFraction, avoiding: avoiding, keyboardMayBeVisible: keyboardMayBeVisible, observeFocusGesture: observeFocusGesture, scrollObservation: scrollObservation)
    }

    /// Nested footer content has a smaller native ScrollView than its tagged outer container. Callers can supply that observed viewport without changing existing tagged-scroll callers.
    @discardableResult
    static func reveal(_ target: XCUIElement, in app: XCUIApplication, scroll: XCUIElement, towardTop: Bool = false, horizontalPosition: CGFloat = 0.5, requireHittable: Bool = true, maximumScrollFraction: CGFloat = 0.45, focusedKeyboardFrame: CGRect? = nil, focusedViewport: CGRect? = nil, avoidTarget: Bool = false, referenceSize: CGSize? = nil, avoiding: XCUIElement? = nil, keyboardMayBeVisible: Bool = true, observeFocusGesture: ((String, CGRect?) -> Void)? = nil, stopAfterFirstFocusDrag: Bool = false, observeFirstDrag: ((CGRect, CGRect, CGRect?, [CGRect], CGVector, CGVector) -> Void)? = nil, scrollObservation: FormScrollObservation? = nil) -> CGRect? {
        XCTAssertTrue(UITestConditions.exists(scroll))
        var lastObservation = ""
        let journalScroll = scroll.identifier == "symptoms-scroll"
        // Observe the last scroll too; otherwise a control revealed by the final allowed gesture is reported missing.
        for attempt in 0 ... 16 {
            // Read-only stages can skip this global AX snapshot when no action can present a keyboard.
            let keyboard = keyboardMayBeVisible ? app.keyboards.firstMatch : nil
            // AX queries are independent. Read each frame once and fail before synthesizing an invalid gesture.
            let applicationFrame = app.frame
            let scrollFrame = scroll.frame
            let keyboardFrame = keyboard?.exists == true ? keyboard?.frame : nil
            let targetFrame = target.exists ? target.frame : nil
            lastObservation = "target=\(String(describing: targetFrame)), scroll=\(scrollFrame), application=\(applicationFrame), keyboard=\(String(describing: keyboardFrame))"
            let controls = journalScroll ? navigationControlFrames(app) : nil
            let usableScroll = journalScroll ? unobstructedScrollFrame(scrollFrame, target: targetFrame, in: app, controls: controls) : scrollFrame
            guard let geometry = FormScrollGeometry.current(application: applicationFrame, scroll: usableScroll, keyboard: keyboardFrame, input: journalScroll ? targetFrame : nil, referenceSize: referenceSize, reservedKeyboard: journalScroll ? nil : focusedKeyboardFrame) else {
                XCTFail("The form has no finite visible viewport: application=\(applicationFrame), scroll=\(scrollFrame), keyboard=\(String(describing: keyboardFrame))")
                return nil
            }
            lastObservation += ", usableViewport=\(geometry.viewport), focusedViewport=\(String(describing: focusedViewport))"
            if let targetFrame, geometry.contains(targetFrame, referenceSize: referenceSize), !requireHittable || target.isHittable {
                // Reuse this exact successful observation if focus later clips the AX frame.
                return targetFrame
            }
            scrollObservation?.observed(targetFrame, completedSteps: attempt)
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
                position = avoidTarget || focusedKeyboardFrame != nil ? targetFrame.flatMap { geometry.horizontalPosition(outside: $0) } : horizontalPosition
            }
            guard let position, var gesture = geometry.gesture(target: targetFrame, towardTop: towardTop, horizontalPosition: position, maximumScrollFraction: maximumScrollFraction, verticalBounds: excludedFrame) else {
                XCTFail("The form gesture has invalid coordinates")
                return nil
            }
            if journalScroll {
                guard let gutter = SymptomJournalUITestObservations.gutterGesture(app, application: applicationFrame, viewport: geometry.viewport, target: targetFrame, controls: controls ?? [], start: gesture.start, end: gesture.end) else { return nil }
                gesture = gutter
            }
            // Anchor to the observed application window, so XCTest cannot re-resolve a disappearing scroller as the coordinate origin.
            let origin = app.coordinate(withNormalizedOffset: .zero)
            let start = origin.withOffset(gesture.start)
            let end = origin.withOffset(gesture.end)
            // Default-speed short drags can move a tall row beyond the opposite edge. Use slow movement only
            // once the target intersects the viewport; keep fast travel, containment, hit testing and the gesture budget.
            let velocity: XCUIGestureVelocity = targetFrame.map { geometry.viewport.intersects($0) } == true ? .slow : .default
            if stopAfterFirstFocusDrag {
                print("Journal single focus drag start=\(gesture.start), end=\(gesture.end), velocity=\(velocity)")
            }
            XCTContext.runActivity(named: "Measured form scroll \(attempt + 1): \(lastObservation)") { _ in
                // Observe the same reserved boundary around the existing gesture, without changing its coordinates or budget.
                observeFocusGesture?("before-scroll-\(attempt + 1)", focusedKeyboardFrame)
                observeFirstDrag?(applicationFrame, geometry.viewport, targetFrame, controls ?? [], gesture.start, gesture.end)
                FormScrollObservation.around(scrollObservation, step: attempt + 1, target: targetFrame,
                                             start: CGPoint(x: gesture.start.dx + applicationFrame.minX, y: gesture.start.dy + applicationFrame.minY),
                                             end: CGPoint(x: gesture.end.dx + applicationFrame.minX, y: gesture.end.dy + applicationFrame.minY))
                {
                    start.press(forDuration: 0.05, thenDragTo: end, withVelocity: velocity, thenHoldForDuration: 0)
                }
                observeFocusGesture?("after-scroll-\(attempt + 1)", focusedKeyboardFrame)
            }
            // Opt-in measurement ends after this unchanged gesture; nil prevents refocus, editing, or another loop iteration.
            if stopAfterFirstFocusDrag || observeFirstDrag != nil {
                observeFocusGesture?("single-observation-complete", focusedKeyboardFrame)
                return nil
            }
        }
        XCTFail("Control did not enter the measured form viewport: \(lastObservation)")
        return nil
    }

    /// Return exposure/edit failure so guarded callers stop before another field or a missing keyboard action.
    @discardableResult
    static func replace(_ input: XCUIElement, with text: String, in app: XCUIApplication, scrollID: String, observeCursorTap: ((String) -> Void)? = nil, observeFocusGesture: ((String, CGRect?) -> Void)? = nil, stopAfterFirstFocusDrag: Bool = false) -> Bool {
        let replaceStartedAt = ProcessInfo.processInfo.systemUptime
        defer { recordTiming("replace-total", since: replaceStartedAt) }
        // Pass measured closures as explicit arguments so Swift binds `else` to each guard statement.
        guard let reference = measure("reveal", { reveal(input, in: app, scrollID: scrollID, observeFocusGesture: observeFocusGesture) }) else { return false }
        let current = measure("value-read") { input.value as? String ?? "" }
        observeFocusGesture?("before-focus-tap", nil)
        measure("field-tap") { input.tap() }
        observeFocusGesture?("after-focus-tap", nil)
        guard measure("focused-input", {
            exposeFocusedInput(input, referenceSize: reference.size, in: app, scrollID: scrollID, observeFocusGesture: observeFocusGesture, stopAfterFirstFocusDrag: stopAfterFirstFocusDrag)
        }) != nil else { return false }
        let shouldReplace = if current.isEmpty {
            false
        } else {
            measure("placeholder-read") { current != input.placeholderValue }
        }
        if shouldReplace {
            // A trailing viewport tap can leave the caret inside internally scrolled text.
            // XCTest's native Command-A selects the entire focused value, including its offscreen suffix.
            // Keep the existing observer around selection without synthesizing another coordinate tap.
            observeCursorTap?("before-select-all")
            measure("select-existing") { app.typeKey("a", modifierFlags: .command) }
            observeCursorTap?("after-select-all")
            // One native delete replaces the selection; exact-empty rejects a missed selection without retrying.
            measure("delete-existing") { app.typeText(XCUIKeyboardKey.delete.rawValue) }
            let emptied = measure("exact-empty") { exactValue(input, equals: "") }
            guard emptied || scrollID != "symptoms-scroll" else { return false }
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
        return measure("exact-value") { exactValue(input, equals: text) }
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
    static func unobstructedScrollFrame(_ scroll: CGRect, target: CGRect?, in app: XCUIApplication, controls: [CGRect]? = nil) -> CGRect {
        var usable = scroll
        for control in controls ?? navigationControlFrames(app) where control.intersects(scroll) {
            if let target, control.maxX <= target.minX || control.minX >= target.maxX {
                continue
            }
            usable.size.height = max(0, min(usable.maxY, control.minY) - usable.minY)
        }
        return usable
    }

    /// Keep main's keyboard-present reveal rule for generic forms; the journal uses current navigation and input geometry.
    private static func exposeFocusedInput(_ input: XCUIElement, referenceSize: CGSize, in app: XCUIApplication, scrollID: String, observeFocusGesture: ((String, CGRect?) -> Void)?, stopAfterFirstFocusDrag: Bool = false) -> (application: CGRect, input: CGRect)? {
        let journal = scrollID == "symptoms-scroll"
        let keyboard = app.keyboards.firstMatch
        // A hardware keyboard can leave no software keyboard. Observe presence without waiting for one to appear.
        let keyboardFrame = keyboard.exists ? keyboard.frame : nil
        let scroll = UITestConditions.element(app, scrollID)
        let applicationFrame = app.frame
        let scrollFrame = scroll.frame
        let inputFrame = input.frame
        let usableScroll = journal ? unobstructedScrollFrame(scrollFrame, target: inputFrame, in: app) : scrollFrame
        guard let geometry = FormScrollGeometry.current(application: applicationFrame, scroll: usableScroll, keyboard: keyboardFrame, input: journal ? inputFrame : nil, referenceSize: referenceSize) else {
            XCTFail("The focused input has no finite keyboard viewport")
            return nil
        }
        // Record the frames already queried by containment, without another AX read or private input value.
        // Native activity timestamps pair these observations with the existing test video if editing fails.
        XCTContext.runActivity(named: "Focused form viewport: application=\(applicationFrame), scroll=\(scrollFrame), keyboard=\(String(describing: keyboardFrame)), input=\(String(describing: inputFrame)), viewport=\(geometry.viewport), referenceSize=\(referenceSize)") { _ in }
        if journal {
            if !geometry.contains(inputFrame, referenceSize: referenceSize) {
                guard reveal(input, in: app, scroll: scroll, towardTop: inputFrame.minY <= geometry.viewport.minY, avoidTarget: true, referenceSize: referenceSize, observeFocusGesture: observeFocusGesture, stopAfterFirstFocusDrag: stopAfterFirstFocusDrag) != nil else { return nil }
                observeFocusGesture?("before-refocus-tap", nil)
                input.tap()
                observeFocusGesture?("after-refocus-tap", nil)
            }
            guard !stopAfterFirstFocusDrag else { return nil }
            return FormFocusedInputConditions.verify(input, referenceSize: referenceSize, in: app, scroll: scroll, journal: true, observeFocusGesture: observeFocusGesture)
        }
        if let keyboardFrame, !geometry.contains(inputFrame, referenceSize: referenceSize) {
            guard let reservation = geometry.keyboardReservation(keyboardFrame, for: inputFrame, referenceSize: referenceSize) else { XCTFail("The focused input has no finite occlusion boundary"); return nil }
            // Preserve the original keyboard reservation during the generic form reveal.
            guard reveal(input, in: app, scroll: scroll, towardTop: inputFrame.minY <= geometry.viewport.minY, focusedKeyboardFrame: reservation, referenceSize: referenceSize) != nil else { return nil }
            input.tap()
        }
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

    private static func exactValue(_ input: XCUIElement, equals text: String) -> Bool {
        // Native key synthesis has completed and waited for the app to idle. A missed edit
        // cannot finish later without another action; fail with its actual value instead of polling forever.
        let value = input.value as? String ?? ""
        let observed = text.isEmpty && value == input.placeholderValue ? "" : value
        XCTAssertEqual(observed, text, "The completed native edit must replace the entire input value")
        return observed == text
    }
}
