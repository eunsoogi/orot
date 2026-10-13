import XCTest

@MainActor
enum UITestConditions {
    /// XCTest's waiter has an initial polling interval even for existing elements. Preserve the actual existence check before that fallback.
    static func exists(_ element: XCUIElement, timeout: TimeInterval = 30) -> Bool {
        element.exists || element.waitForExistence(timeout: timeout)
    }

    /// Check the actual accessible value; do not sleep or accept a missing element as completion.
    static func value(_ element: XCUIElement, equals expected: String, timeout: TimeInterval = 30) {
        let predicate = NSPredicate { candidate, _ in
            guard let candidate = candidate as? XCUIElement, candidate.exists else { return false }
            return candidate.label == expected || candidate.value as? String == expected
        }
        if predicate.evaluate(with: element) {
            return
        }
        let condition = XCTNSPredicateExpectation(predicate: predicate, object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [condition], timeout: timeout), .completed,
                       "Expected \(expected); observed \(element.debugDescription)")
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
