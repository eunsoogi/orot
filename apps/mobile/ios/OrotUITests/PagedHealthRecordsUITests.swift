import XCTest

/// Uses the original 1,503-record adapter and real native navigation, with no HealthKit or persisted-source claim.
final class PagedHealthRecordsUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testSecondPageValueAndShortThenCompleteNativeBackSwipe() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        app.launchArguments = ["-OROT_TEST_SCENARIO", "paged-records"]
        app.launch()
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        let library = UITestConditions.element(app, "records-open-health-library")
        XCTAssertTrue(library.waitForExistence(timeout: 30))
        library.tap()
        let list = UITestConditions.element(app, "health-records-scroll")
        XCTAssertTrue(list.waitForExistence(timeout: 30))
        XCTAssertTrue(UITestConditions.element(app, "health-record-row-0").waitForExistence(timeout: 30))
        let row = UITestConditions.element(app, "health-record-row-55")
        // Page size is 50, so this assertion requires a genuine second-page request from the production list.
        FormUITestConditions.reveal(row, in: app, scrollID: "health-records-scroll")
        UITestConditions.value(UITestConditions.element(app, "health-record-row-55-value"), equals: "85 count/min")
        capture(app, "health-second-page-row-55")
        backSwipe(list, fraction: 0.1)
        XCTAssertTrue(list.exists && list.isHittable, app.debugDescription)
        XCTAssertFalse(library.isHittable, app.debugDescription)
        capture(app, "health-short-edge-swipe-preserves-route")
        backSwipe(list, fraction: 0.9)
        let returned = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            library.exists && library.isHittable && !list.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [returned], timeout: 10), .completed, app.debugDescription)
        capture(app, "health-native-edge-back-completed")
    }

    @MainActor
    private func backSwipe(_ list: XCUIElement, fraction: CGFloat) {
        XCTAssertTrue(!list.frame.isEmpty)
        // Retain the original measured list-edge origin, short 10% cancellation, and long 90% completion.
        let start = list.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5))
        let end = list.coordinate(withNormalizedOffset: CGVector(dx: 0.01 + fraction, dy: 0.5))
        start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0)
    }

    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
