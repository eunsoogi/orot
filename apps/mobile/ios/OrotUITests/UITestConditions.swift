import XCTest

@MainActor
enum UITestConditions {
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

    static func text(_ element: XCUIElement) -> String {
        if let value = element.value as? String, !value.isEmpty {
            return value
        }
        return element.label
    }

    static func scrollTo(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0 ..< 8 {
            if element.exists, element.isHittable {
                return
            }
            app.swipeUp()
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
