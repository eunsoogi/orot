import XCTest

/// Uses the original 1,503-record adapter and real native navigation, with no HealthKit or persisted-source claim.
final class PagedHealthRecordsUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testSecondPageValueAndShortThenCompleteBackSwipe() throws {
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
        backSwipe(list, in: app, fraction: 0.1)
        let preserved = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in list.exists && list.isHittable }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [preserved], timeout: 10), .completed, app.debugDescription)
        let underlying = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !library.isHittable }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [underlying], timeout: 10), .completed, app.debugDescription)
        capture(app, "health-short-edge-swipe-preserves-route")
        backSwipe(list, in: app, fraction: 0.9)
        let returned = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            library.exists && library.isHittable && !list.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [returned], timeout: 10), .completed, app.debugDescription)
        capture(app, "health-edge-back-completed")
    }

    @MainActor
    private func backSwipe(_ list: XCUIElement, in app: XCUIApplication, fraction: CGFloat) {
        XCTAssertTrue(!list.frame.isEmpty)
        // Retain the original measured list-edge origin, short 10% cancellation, and long 90% completion.
        // The list moves during interactive pop. Freeze both screen points against the app window so the endpoint cannot follow it.
        let frame = list.frame
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let start = origin.withOffset(CGVector(dx: frame.minX + frame.width * 0.01, dy: frame.midY))
        let end = origin.withOffset(CGVector(dx: frame.minX + frame.width * (0.01 + fraction), dy: frame.midY))
        // The hosted 500-pixel/second short gesture completed the pop. Retain a controlled slow partial drag, not a velocity-driven flick.
        let velocity = XCUIGestureVelocity(rawValue: fraction <= 0.1 ? 80 : 500)
        start.press(forDuration: 0.1, thenDragTo: end, withVelocity: velocity, thenHoldForDuration: 0)
    }

    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
