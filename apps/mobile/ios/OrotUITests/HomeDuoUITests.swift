import XCTest

/// Exercises the production Home route with a local appointment fixture and live native navigation geometry.
final class HomeDuoUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testHomeSummariesReflowAndVisitPreparationRemainsReachable() throws {
        let app = XCUIApplication()
        defer {
            app.terminate()
            XCUIDevice.shared.orientation = .portrait
        }

        app.launchArguments = [
            "-OROT_E2E_PROBE", "medical-appointment-app-navigation",
            "-OROT_HOME_APPOINTMENT_TIMING", "YES",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryLarge",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        XCTAssertTrue(UITestConditions.element(app, "welcome-title").waitForAppearance())

        try verifyHomePanelsAndNavigationLane(app)
        let preparation = app.buttons.matching(identifier: "home-prepare-visit").firstMatch
        XCTAssertEqual(app.buttons.matching(identifier: "home-prepare-visit").count, 1)
        UITestConditions.scrollTo(preparation, in: app)
        preparation.tap()
        NavigationUITestConditions.route(app, markers: ["next-visit-questions-scroll"])
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        XCTAssertTrue(try NavigationUITestConditions.navigationAction(app, "navigation-tab-home").control.isSelected)

        let portraitWidth = app.frame.width
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let frame = app.frame
            return frame.width > frame.height && abs(frame.width - portraitWidth) > 0.5
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [landscape]), .completed)
        try verifyHomePanelsAndNavigationLane(app)
        capture(app, "home-landscape-adaptive-panels")

        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = [
            "-OROT_E2E_PROBE", "medical-appointment-app-navigation",
            "-OROT_HOME_APPOINTMENT_TIMING", "YES",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        XCTAssertTrue(UITestConditions.element(app, "welcome-title").waitForAppearance())
        try verifyHomePanelsAndNavigationLane(app, expectsStackedPanels: true)
        let largeTextPreparation = app.buttons.matching(identifier: "home-prepare-visit").firstMatch
        UITestConditions.scrollTo(largeTextPreparation, in: app)
        largeTextPreparation.tap()
        NavigationUITestConditions.route(app, markers: ["next-visit-questions-scroll"])
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
    }

    /// Checks the actual panel frames against each other and against the live root navigation surface.
    @MainActor
    private func verifyHomePanelsAndNavigationLane(
        _ app: XCUIApplication,
        expectsStackedPanels: Bool = false,
    ) throws {
        let primary = UITestConditions.element(app, "home-adaptive-columns-primary")
        let secondary = UITestConditions.element(app, "home-adaptive-columns-secondary")
        XCTAssertTrue(primary.waitForAppearance())
        XCTAssertTrue(secondary.waitForAppearance())
        let primaryFrame = primary.frame
        let secondaryFrame = secondary.frame
        let sideBySide = abs(primaryFrame.minY - secondaryFrame.minY) <= 1 &&
            primaryFrame.maxX <= secondaryFrame.minX + 1
        let stacked = abs(primaryFrame.minX - secondaryFrame.minX) <= 1 &&
            primaryFrame.maxY <= secondaryFrame.minY + 1
        XCTAssertTrue(
            sideBySide || stacked,
            "Home panels must follow one readable measured column or two non-overlapping columns: primary=\(primaryFrame), secondary=\(secondaryFrame)",
        )
        if expectsStackedPanels {
            XCTAssertTrue(stacked, "Large text must retain a single readable Home column")
        }

        let navigation = try NavigationUITestConditions.navigationAction(app, "navigation-tab-home")
        XCTAssertTrue(navigation.control.isSelected)
        if navigation.toolbar.frame.height > navigation.toolbar.frame.width {
            // The live right rail marks expanded Duo geometry, where regular text should use both panels.
            if !expectsStackedPanels {
                XCTAssertTrue(sideBySide, "Expanded Home panels should use the measured Duo content width")
            }
            XCTAssertLessThanOrEqual(max(primaryFrame.maxX, secondaryFrame.maxX), navigation.toolbar.frame.minX + 1,
                                     "Home content must stay outside the measured right navigation lane")
        } else {
            try NavigationUITestConditions.contentAboveBar(
                app,
                scrollID: "navigation-route-scroll",
                contentID: "home-open-records",
                navigationID: "navigation-tab-home",
            )
        }
    }

    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        // Keep the real rendered Home panels available as review evidence after native reflow.
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
