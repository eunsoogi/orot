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
        captureScrollDiagnosticPair: Bool = false,
    ) {
        let checkbox = element(app, identifier)
        scrollTo(checkbox, in: container, captureScrollDiagnosticPair: captureScrollDiagnosticPair)
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

    /// Opts the Home journey into a bounded diagnostic only for its landscape sleep row.
    static func shouldCaptureHomeScrollDiagnosticPair(for metric: String) -> Bool {
        ProcessInfo.processInfo.environment["OROT_HOME_SCROLL_DIAGNOSTIC_PAIR"] == "1" &&
            metric == "sleep" && XCUIDevice.shared.orientation == .landscapeLeft
    }

    /// Scroll the caller-owned viewport; a caller may capture one bounded Home diagnostic pair.
    static func scrollTo(
        _ element: XCUIElement,
        in container: XCUIElement,
        searchTowardTop: Bool = false,
        captureScrollDiagnosticPair: Bool = false,
    ) {
        for _ in 0 ..< 8 {
            let targetExists = element.exists
            if targetExists, element.isHittable {
                return
            }

            if captureScrollDiagnosticPair {
                func nextDirection(targetExists: Bool) -> String {
                    (targetExists ? element.frame.midY < container.frame.midY : searchTowardTop) ? "down" : "up"
                }
                let firstDirection = nextDirection(targetExists: targetExists)
                performHomeScrollDiagnosticSwipe(firstDirection, element: element, in: container, phase: "first")
                if element.exists, element.isHittable {
                    return
                }
                let secondDirection = nextDirection(targetExists: element.exists)
                performHomeScrollDiagnosticSwipe(secondDirection, element: element, in: container, phase: "second")
                XCTAssertTrue(
                    element.exists && element.isHittable,
                    "Home scroll diagnostic did not reveal \(element.identifier) after two swipes: \(element.debugDescription)",
                )
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

    /// Records the selected reveal direction and actual viewport, content and target geometry around one swipe.
    private static func performHomeScrollDiagnosticSwipe(
        _ direction: String,
        element: XCUIElement,
        in container: XCUIElement,
        phase: String,
    ) {
        logHomeScrollDiagnostic(element, in: container, phase: "\(phase)-start", direction: direction)
        let startedAtMs = Date().timeIntervalSince1970 * 1000
        if direction == "down" {
            container.swipeDown()
        } else {
            container.swipeUp()
        }
        let endedAtMs = Date().timeIntervalSince1970 * 1000
        logHomeScrollDiagnostic(element, in: container, phase: "\(phase)-end", direction: direction)
        print("OROT_HOME_SCROLL_GESTURE direction=\(direction) startedAtMs=\(startedAtMs) endedAtMs=\(endedAtMs)")
    }

    private static func logHomeScrollDiagnostic(
        _ element: XCUIElement,
        in container: XCUIElement,
        phase: String,
        direction: String,
    ) {
        let scrollView = container.scrollViews.firstMatch
        let editor = container.descendants(matching: .any)
            .matching(identifier: "home-metric-selection-editor")
            .firstMatch
        let viewport = scrollView.exists ? scrollView.frame : .zero
        let editorFrame = editor.exists ? String(describing: editor.frame) : "unavailable"
        let targetExists = element.exists
        let targetHittable = targetExists && element.isHittable
        let targetFrame = targetExists ? String(describing: element.frame) : "unavailable"
        let targetLabel = targetExists ? element.label : "unavailable"
        let targetValue = targetExists ? String(describing: element.value) : "unavailable"
        print(
            "OROT_HOME_SCROLL_DIAGNOSTIC phase=\(phase) nextDirection=\(direction) " +
                "observedAtMs=\(Date().timeIntervalSince1970 * 1000) " +
                "orientation=\(XCUIDevice.shared.orientation.rawValue) " +
                "containerID=\(container.identifier) container=\(container.frame) " +
                "scrollViewType=\(scrollView.elementType) viewportExists=\(scrollView.exists) viewport=\(viewport) " +
                "contentID=home-metric-selection-editor contentExists=\(editor.exists) contentFrame=\(editorFrame) " +
                "targetExists=\(targetExists) targetHittable=\(targetHittable) " +
                "target=\(targetFrame) targetLabel=\(targetLabel) targetValue=\(targetValue)",
        )
    }
}

extension XCUIElement {
    /// Shares the completion-based existence policy with callers using a fluent element query.
    @MainActor
    func waitForAppearance() -> Bool {
        UITestConditions.exists(self)
    }
}
