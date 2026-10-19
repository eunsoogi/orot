import XCTest

/// Small synthetic pages exercise the production list and native gestures; SQLCipher integration owns large-library correctness.
final class PagedHealthRecordsUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testSecondPageValueAndShortThenCompleteBackSwipe() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        app.launchArguments = ["-OROT_TEST_SCENARIO", "paged-records", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES"]
        app.launch()
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        let library = UITestConditions.element(app, "records-open-health-library")
        XCTAssertTrue(library.waitForAppearance())
        library.tap()
        let overview = UITestConditions.element(app, "health-records-scroll")
        XCTAssertTrue(overview.waitForAppearance())
        let detail = UITestConditions.element(app, "health-record-open-detail-heart_rate")
        XCTAssertTrue(detail.waitForAppearance())
        detail.tap()
        let list = UITestConditions.element(app, "health-records-detail-scroll")
        XCTAssertTrue(list.waitForAppearance())
        XCTAssertTrue(UITestConditions.element(app, "health-record-row-0").waitForAppearance())
        let row = UITestConditions.element(app, "health-record-row-5")
        // The selected month spans multiple storage pages; the detail list must retain the later-page value.
        FormUITestConditions.reveal(row, in: app, scrollID: "health-records-detail-scroll", maximumScrollFraction: 0.7)
        UITestConditions.value(UITestConditions.element(app, "health-record-row-5-value"), equals: "65 count/min")
        let requestText = UITestConditions.text(UITestConditions.element(app, "health-pagination-requests"))
        let requests = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(requestText.utf8)) as? [String: Any])
        XCTAssertEqual(requests["pageSize"] as? Int, 4)
        XCTAssertTrue((requests["requestedCursors"] as? [String] ?? []).contains("synthetic-health-0003"))
        capture(app, "health-second-page-row-5")
        captureNavigationObservation(app, "health-before-edge-back")
        backSwipe(list, in: app, fraction: 0.1)
        let preserved = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in list.exists && list.isHittable }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [preserved]), .completed, app.debugDescription)
        let underlying = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !library.isHittable }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [underlying]), .completed, app.debugDescription)
        capture(app, "health-short-edge-swipe-preserves-route")
        captureNavigationObservation(app, "health-after-short-edge-back")
        backSwipe(list, in: app, fraction: 0.9)
        // The detail list is pushed above the chart overview, so one completed back gesture pops only that screen.
        let returned = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            overview.exists && overview.isHittable && !list.exists && !library.isHittable
        }, object: nil)
        let returnResult = UITestConditions.wait(for: [returned])
        // Preserve the native gesture and route outcome before a failing assertion stops the case.
        captureNavigationObservation(app, "health-after-return-wait")
        XCTAssertEqual(returnResult, .completed, app.debugDescription)
        capture(app, "health-edge-back-completed")
    }

    @MainActor
    private func captureNavigationObservation(_ app: XCUIApplication, _ name: String) {
        let marker = UITestConditions.element(app, "navigation-test-observation")
        let attachment = XCTAttachment(data: Data(UITestConditions.text(marker).utf8), uniformTypeIdentifier: "public.json")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func backSwipe(_ list: XCUIElement, in app: XCUIApplication, fraction: CGFloat) {
        let frame = list.frame
        let window = app.frame
        XCTAssertTrue(!frame.isEmpty && !window.isEmpty)
        // UIKit's edge recognizer belongs to the window. An inset list origin can select content-pop instead.
        // Freeze window-based horizontal points and the list's vertical midpoint before the interactive transition moves either view.
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let start = origin.withOffset(CGVector(dx: window.width * 0.01, dy: frame.midY - window.minY))
        let end = origin.withOffset(CGVector(dx: window.width * (0.01 + fraction), dy: frame.midY - window.minY))
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
