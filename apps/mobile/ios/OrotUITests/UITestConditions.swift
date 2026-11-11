import XCTest

@MainActor
enum UITestConditions {
    /// A validated fixture session owns host cleanup and verifies the app's removal or reset.
    /// Avoid duplicate XCTest termination acknowledgements; standalone tests still clean up their app.
    static func terminateStandaloneApp(_ app: XCUIApplication) {
        if ProcessInfo.processInfo.environment["OROT_IOS_FIXTURE_SESSION"] == nil {
            app.terminate()
        }
    }

    /// Await the condition itself. Poll pacing yields the run loop; it does not impose a completion budget.
    /// Cancellation never reports success. Synchronous Apple AX IPC still cannot be interrupted here.
    static func wait(for conditions: [XCTNSPredicateExpectation], cancelled: () -> Bool = { withUnsafeCurrentTask { $0?.isCancelled ?? false } }) -> XCTWaiter.Result {
        precondition(!conditions.isEmpty && conditions.allSatisfy { !$0.isInverted })
        var pending = conditions
        while !cancelled() {
            pending.removeAll { condition in
                condition.predicate.evaluate(with: condition.object) && (condition.handler?() ?? true)
            }
            // A synchronous AX read or handler may return after cancellation has arrived.
            guard !cancelled() else { return .interrupted }
            if pending.isEmpty {
                return .completed
            }
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05))
        }
        return .interrupted
    }

    static func exists(_ element: XCUIElement, cancelled: () -> Bool = { withUnsafeCurrentTask { $0?.isCancelled ?? false } }) -> Bool {
        let condition = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in element.exists }, object: nil)
        return wait(for: [condition], cancelled: cancelled) == .completed
    }

    /// One snapshot retains the original label-or-value oracle without rejecting a slow successful read.
    static func value(_ element: XCUIElement, equals expected: String, cancelled: () -> Bool = { withUnsafeCurrentTask { $0?.isCancelled ?? false } }) {
        var lastObservation: (label: String, value: String?)?
        let predicate = NSPredicate { _, _ in
            guard let snapshot = try? element.snapshot() else {
                lastObservation = nil
                return false
            }
            lastObservation = (snapshot.label, snapshot.value as? String)
            return snapshot.label == expected || snapshot.value as? String == expected
        }
        // Passing a live element to XCTest can cause extra hierarchy queries unrelated to this oracle.
        let condition = XCTNSPredicateExpectation(predicate: predicate, object: nil)
        XCTAssertEqual(wait(for: [condition], cancelled: cancelled), .completed,
                       "Expected \(expected); last observation \(String(describing: lastObservation))")
    }

    static func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    /// Read the successful create result and require one native selection for that exact record.
    static func appointmentIdentity(_ app: XCUIApplication, previous: String = "") -> String {
        let marker = element(app, "appointment-created-identity")
        var identity = ""
        let updated = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            identity = marker.label
            return identity.hasPrefix("appointment-") && identity != previous
        }, object: nil)
        XCTAssertEqual(wait(for: [updated]), .completed)
        let matches = app.buttons.matching(identifier: "appointment-select-\(identity)")
        XCTAssertTrue(matches.firstMatch.waitForAppearance())
        XCTAssertEqual(matches.count, 1, "Expected one selection control for the created appointment")
        return identity
    }

    static func waitForWindowBoundsChange(in app: XCUIApplication, from previous: CGRect) {
        var current = CGRect.zero
        let boundsChanged = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                current = app.frame
                return abs(current.width - previous.width) > 0.5 ||
                    abs(current.height - previous.height) > 0.5
            },
            object: nil,
        )
        XCTAssertEqual(
            UITestConditions.wait(for: [boundsChanged]),
            .completed,
            "Appointments must observe the device's updated UIKit bounds.",
        )
    }

    /// React Native exposes a checkbox's VoiceOver state through its localized accessibility value.
    static func checkboxIsChecked(_ element: XCUIElement) -> Bool {
        let value = (element.value as? String)?.lowercased() ?? ""
        XCTAssertTrue(
            value.contains("checked") || value.contains("unchecked"),
            "Checkbox value must expose its checked state: \(element.debugDescription)",
        )
        return value.contains("checked") && !value.contains("unchecked")
    }

    /// Verify that an accessibility activation changes checkbox state while retaining a native hit target.
    static func toggleCheckboxAndAssertState(
        _ element: XCUIElement,
        minimumHitHeight: CGFloat = 44,
    ) {
        let initialState = checkboxIsChecked(element)
        XCTAssertTrue(
            element.exists && element.isHittable && element.frame.height >= minimumHitHeight,
            element.debugDescription,
        )
        element.tap()
        XCTAssertTrue(
            element.exists && element.isHittable && element.frame.height >= minimumHitHeight,
            element.debugDescription,
        )
        XCTAssertNotEqual(checkboxIsChecked(element), initialState, element.debugDescription)
    }

    /// Resolve and reveal an identifier-matched checkbox before reading its native accessibility state.
    static func toggleCheckboxAndAssertState(
        _ app: XCUIApplication,
        identifier: String,
        in container: XCUIElement,
        minimumHitHeight: CGFloat = 44,
    ) {
        let checkbox = element(app, identifier)
        scrollTo(checkbox, in: container)
        toggleCheckboxAndAssertState(checkbox, minimumHitHeight: minimumHitHeight)
    }

    /// Reveal an identifier-matched target in its owning viewport before activating its native hit target.
    static func scrollToAndTap(_ element: XCUIElement, in container: XCUIElement) {
        scrollTo(element, in: container)
        XCTAssertTrue(element.exists && element.isHittable, element.debugDescription)
        element.tap()
    }

    static func text(_ element: XCUIElement) -> String {
        // One snapshot keeps the empty-value label fallback within a single Accessibility observation.
        guard let snapshot = try? element.snapshot() else {
            if let value = element.value as? String, !value.isEmpty {
                return value
            }
            return element.label
        }
        if let value = snapshot.value as? String, !value.isEmpty {
            return value
        }
        return snapshot.label
    }

    /// Keep ordinary scroll callers on XCTest's existing swipe behavior.
    static func scrollTo(
        _ element: XCUIElement,
        in container: XCUIElement,
        searchTowardTop: Bool = false,
    ) {
        for _ in 0 ..< 8 {
            let targetExists = element.exists
            if targetExists, element.isHittable {
                return
            }

            // Use the caller's hint only when accessibility has not resolved a frame yet.
            if targetExists ? element.frame.midY < container.frame.midY : searchTowardTop {
                container.swipeDown()
            } else {
                container.swipeUp()
            }
        }
        XCTAssertTrue(element.exists && element.isHittable, element.debugDescription)
    }
}

extension XCUIElement {
    /// Shares the completion-based existence policy with callers using a fluent element query.
    @MainActor
    func waitForAppearance() -> Bool {
        UITestConditions.exists(self)
    }
}
