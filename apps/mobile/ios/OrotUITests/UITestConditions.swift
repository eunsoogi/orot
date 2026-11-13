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
                guard app.windows.count == 1, app.windows.firstMatch.exists else { return false }
                current = app.windows.firstMatch.frame
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

    /// Requests real scene geometry and requires a correlated callback before checking AX reflow.
    static func rotateAppointmentScene(_ app: XCUIApplication, session: String, landscape: Bool) throws {
        let control = element(app, "rotation-transition-request")
        func command(_ mode: String) throws -> [String: Any] {
            XCTAssertTrue(control.exists && control.isHittable, "Rotation control frame: \(control.frame)")
            control.tap()
            var receipt: [String: Any] = [:]
            let updated = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                guard let value = try? JSONSerialization.jsonObject(with: Data(control.label.utf8)) as? [String: Any],
                      value["session"] as? String == session, value["mode"] as? String == mode else { return false }
                receipt = value
                return true
            }, object: nil)
            guard XCTWaiter.wait(for: [updated], timeout: 15) == .completed else {
                throw NSError(domain: "RotationReceiptUnavailable", code: 1)
            }
            return receipt
        }
        // Keyboard and system surfaces can expose additional AX windows; bind the
        // rotation control to the same unique window as the appointment page.
        let scroll = element(app, "appointments-scroll")
        XCTAssertTrue(scroll.exists && control.exists, "Appointment page and rotation control must be observable")
        let window = try XCTUnwrap(FormWindowOwnership.resolve(app, scroll: scroll, target: control))
        let initial = window.frame
        let armed = try command("start")
        XCTAssertEqual(armed["status"] as? String, "sampled")
        XCUIDevice.shared.orientation = landscape ? .landscapeLeft : .portrait
        let requested = try command(landscape ? "request" : "portrait")
        XCTAssertEqual(requested["status"] as? String, "sampled")
        let receipt = try command("read")
        // Preserve only the probe's scalar geometry and session metadata for failure diagnosis.
        let receiptData = try JSONSerialization.data(withJSONObject: receipt, options: .sortedKeys)
        XCTContext.runActivity(named: "Scene geometry receipt") { activity in
            let attachment = XCTAttachment(data: receiptData, uniformTypeIdentifier: "public.json")
            attachment.name = landscape ? "scene-geometry-landscape" : "scene-geometry-portrait"
            attachment.lifetime = .keepAlways
            activity.add(attachment)
        }
        XCTAssertEqual(receipt["status"] as? String, "sampled")
        XCTAssertTrue((receipt["error"] as? [String: Any])?.isEmpty == true)
        XCTAssertLessThanOrEqual(try XCTUnwrap(receipt["requestCount"] as? Int), 1)
        let current = try XCTUnwrap(receipt["windowBounds"] as? [String: Double])
        let events = try XCTUnwrap(receipt["events"] as? [[String: Any]])
        XCTAssertTrue(events.contains { event in
            guard let width = event["width"] as? Double, let height = event["height"] as? Double else { return false }
            return width == current["width"] && height == current["height"] &&
                (landscape ? width > height : height > width)
        }, "No correlated current scene geometry event: \(receipt)")
        let bounds = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            // Re-resolve on every observation because AX window indices can change.
            guard scroll.exists, control.exists,
                  let owner = FormWindowOwnership.resolve(app, scroll: scroll, target: control, reportFailure: false) else { return false }
            let frame = owner.frame
            return (abs(frame.width - initial.width) > 0.5 || abs(frame.height - initial.height) > 0.5) &&
                abs(frame.width - (current["width"] ?? 0)) <= 0.5 && abs(frame.height - (current["height"] ?? 0)) <= 0.5 &&
                (landscape ? frame.width > frame.height : frame.height > frame.width)
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [bounds], timeout: 15), .completed, "AX window did not reflow")
        XCTAssertTrue(scroll.exists && control.exists, "Appointment page and rotation control must remain observable")
        _ = try XCTUnwrap(FormWindowOwnership.resolve(app, scroll: scroll, target: control))
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
