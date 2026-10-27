import XCTest

/// Checks the Records page against the live right-rail geometry on the Duo destination.
final class RecordsHubUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testRecordsLaneSurvivesOrientationAndAppearanceChangesAtDefaultAndLargeText() throws {
        let standard = launch(AppearanceUITestConditions.observationArguments)
        var originalAppearance: AppearanceUITestConditions.Snapshot?
        defer {
            restoreAppearance(originalAppearance, app: standard)
            standard.terminate()
            XCUIDevice.shared.orientation = .portrait
        }

        _ = try AppearanceUITestConditions.select(false, returningTo: standard, testCase: self) {
            originalAppearance = $0
        }
        try openRecords(in: standard)
        let defaultTitleHeight = UITestConditions.element(standard, "records-title").frame.height
        let record = UITestConditions.element(standard, "records-new-recording")
        record.tap()
        NavigationUITestConditions.route(standard, markers: ["recording-controls-scroll"])
        try NavigationUITestConditions.tapNavigation(standard, "navigation-back")
        try assertRecordsPrimaryLane(in: standard)

        let portraitBounds = standard.frame
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForWindowBoundsChange(in: standard, from: portraitBounds)
        try assertRecordsPrimaryLane(in: standard)
        let landscapeBounds = standard.frame
        XCUIDevice.shared.orientation = .portrait
        waitForWindowBoundsChange(in: standard, from: landscapeBounds)
        try assertRecordsPrimaryLane(in: standard)

        _ = try AppearanceUITestConditions.select(true, returningTo: standard, testCase: self)
        try assertRecordsPrimaryLane(in: standard)
        capture(standard, "records-duo-dark-appearance")
        try assertRecentSourcesLane(in: standard)
        capture(standard, "records-duo-dark-recent-sources")

        if let capturedAppearance = originalAppearance {
            try AppearanceUITestConditions.restore(capturedAppearance, returningTo: standard, testCase: self)
            originalAppearance = nil
        }
        if standard.state != .notRunning {
            standard.terminate()
        }

        let largeText = launch([
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityXXXL",
        ])
        defer {
            if largeText.state != .notRunning {
                largeText.terminate()
            }
            XCUIDevice.shared.orientation = .portrait
        }
        try openRecords(in: largeText)
        XCTAssertGreaterThan(
            UITestConditions.element(largeText, "records-title").frame.height,
            defaultTitleHeight,
            "The Records title must reflect the active accessibility text size.",
        )
        try assertRecordsPrimaryLane(in: largeText)
        try assertRecentSourcesLane(in: largeText)
        capture(largeText, "records-duo-large-text-content-lane")
    }

    @MainActor
    private func launch(_ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_PROFILE",
            "core",
            "-AppleLanguages",
            "(en)",
            "-AppleLocale",
            "en_US",
        ] + extra
        app.launch()
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        return app
    }

    @MainActor
    private func openRecords(in app: XCUIApplication) throws {
        try NavigationUITestConditions.openTab(
            app,
            "records",
            markers: ["records-title"],
        )
        try assertRecordsPrimaryLane(in: app)
    }

    @MainActor
    private func assertRecordsPrimaryLane(in app: XCUIApplication) throws {
        NavigationUITestConditions.route(
            app,
            markers: ["records-title"],
        )
        let rail = try NavigationUITestConditions.navigationAction(
            app,
            "navigation-tab-records",
        )
        let primary = UITestConditions.element(app, "records-new-recording")
        XCTAssertTrue(primary.exists && primary.isHittable)
        XCTAssertEqual(rail.toolbar.frame.width, 48, accuracy: 0.5)

        // Compare to UIKit's rendered rail; a fixed device width would miss Split View and text scaling.
        XCTAssertLessThanOrEqual(primary.frame.maxX, rail.toolbar.frame.minX)
    }

    @MainActor
    private func assertRecentSourcesLane(in app: XCUIApplication) throws {
        // Use the persistent heading as readiness, then scroll the real route to the lower panel.
        NavigationUITestConditions.route(app, markers: ["records-title"])
        try NavigationUITestConditions.scrollToBottom(app, "navigation-route-scroll")
        NavigationUITestConditions.route(app, markers: ["records-recent-sources"])

        let rail = try NavigationUITestConditions.navigationAction(
            app,
            "navigation-tab-records",
        )
        let primary = UITestConditions.element(app, "records-new-recording")
        let recentSources = UITestConditions.element(app, "records-recent-sources")
        XCTAssertTrue(recentSources.exists && recentSources.frame.intersects(app.frame))
        XCTAssertEqual(rail.toolbar.frame.width, 48, accuracy: 0.5)

        // Both columns must remain inside the measured content lane after scrolling.
        XCTAssertLessThanOrEqual(primary.frame.maxX, rail.toolbar.frame.minX)
        XCTAssertLessThanOrEqual(recentSources.frame.maxX, rail.toolbar.frame.minX)
    }

    @MainActor
    private func waitForWindowBoundsChange(in app: XCUIApplication, from previous: CGRect) {
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
            "The Records screen must observe the device's updated UIKit bounds.",
        )
    }

    @MainActor
    private func restoreAppearance(
        _ appearance: AppearanceUITestConditions.Snapshot?,
        app: XCUIApplication,
    ) {
        guard let appearance else { return }
        do {
            try AppearanceUITestConditions.restore(appearance, returningTo: app, testCase: self)
        } catch {
            XCTFail("Could not restore Simulator appearance: \(error)")
        }
    }

    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
