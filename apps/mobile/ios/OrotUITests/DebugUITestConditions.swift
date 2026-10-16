import XCTest

@MainActor
enum DebugUITestConditions {
    /// Debug LogBox can cover the production tab bar. Dismiss its exact observed toast, retaining app logs and product alerts.
    static func dismissWarningToast(_ app: XCUIApplication) {
        let warning = app.otherElements.matching(NSPredicate(format: "label == %@", "!, Open debugger to view warnings.")).firstMatch
        guard warning.exists else { return }
        let frame = warning.frame
        XCTAssertTrue(!frame.isEmpty && app.frame.contains(frame), warning.debugDescription)
        // The pinned LogBox layout uses 12-point horizontal padding and a 20-point close button, centered 22 points from the trailing edge.
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame.maxX - app.frame.minX - 22,
                                                                        dy: frame.midY - app.frame.minY)).tap()
        let absent = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !warning.exists }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [absent]), .completed, app.debugDescription)
    }
}
