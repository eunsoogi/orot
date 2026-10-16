import XCTest

@MainActor
enum UITestConditions {
    /// Let XCTest own the existence wait; a separate synchronous preflight can block before its timeout starts.
    static func exists(_ element: XCUIElement, timeout: TimeInterval = 30) -> Bool {
        element.waitForExistence(timeout: timeout)
    }

    /// Read one coherent observation per evaluation and reject matches returned after the original deadline.
    /// A snapshot is still synchronous Apple IPC: the waiter cannot interrupt it, but a late return cannot pass.
    static func value(_ element: XCUIElement, equals expected: String, timeout: TimeInterval = 30) {
        let started = ProcessInfo.processInfo.systemUptime
        var elapsed: TimeInterval = 0
        var lastObservation: (label: String, value: String?)?
        let predicate = NSPredicate { _, _ in
            guard ProcessInfo.processInfo.systemUptime - started <= timeout else { return false }
            if let snapshot = try? element.snapshot() {
                lastObservation = (snapshot.label, snapshot.value as? String)
            } else {
                // Missing or failed reads are observations of unavailability, never a retained earlier match.
                lastObservation = nil
            }
            elapsed = ProcessInfo.processInfo.systemUptime - started
            guard elapsed <= timeout, let observation = lastObservation else { return false }
            return observation.label == expected || observation.value == expected
        }
        // A live XCUIElement expectation object asks XCTest to describe the hierarchy on every poll.
        // Keep only the last already-read fields for failure output, without a new post-deadline AX query.
        let condition = XCTNSPredicateExpectation(predicate: predicate, object: nil)
        let result = XCTWaiter.wait(for: [condition], timeout: timeout)
        XCTAssertEqual(result, .completed,
                       "Expected \(expected); last observation \(String(describing: lastObservation)) after \(elapsed) seconds")
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
