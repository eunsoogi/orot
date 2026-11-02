import XCTest

/// Exercises the production Home route with a local appointment fixture and live native navigation geometry.
final class HomeDuoUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// Measure the large-text regression independently of scroll-driven reachability.
    @MainActor
    func testLargeTextHomeActionsStayWithinContentWidth() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = [
            "-OROT_E2E_PROBE", "medical-appointment-app-navigation",
            "-OROT_HOME_APPOINTMENT_TIMING", "YES",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        let page = UITestConditions.element(app, "home-overview-sections")
        XCTAssertTrue(page.waitForAppearance())
        let navigation = try NavigationUITestConditions.navigationAction(app, "navigation-tab-home")
        let identifiers = ["home-prepare-visit", "home-metrics-edit", "home-open-symptoms"]
        // The section exists while the appointment and symptom fixtures are still loading.
        for identifier in identifiers {
            XCTAssertTrue(UITestConditions.element(app, identifier).waitForAppearance(), identifier)
        }
        // The edit action is disabled until the metric read completes and its cards are rendered.
        let edit = UITestConditions.element(app, "home-metrics-edit")
        let metricsReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in edit.isEnabled }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [metricsReady]), .completed)
        let pageFrame = page.frame
        XCTAssertGreaterThan(pageFrame.width, 0)
        var previousY = -CGFloat.infinity
        for identifier in identifiers {
            let action = UITestConditions.element(app, identifier)
            XCTAssertTrue(action.exists, identifier)
            let frame = action.frame
            XCTAssertGreaterThanOrEqual(frame.height, 44, identifier)
            XCTAssertGreaterThan(frame.minY, previousY, identifier)
            XCTAssertGreaterThanOrEqual(frame.minX, pageFrame.minX - 1, identifier)
            XCTAssertLessThanOrEqual(frame.maxX, pageFrame.maxX + 1, identifier)
            previousY = frame.minY
        }
        if navigation.toolbar.frame.height > navigation.toolbar.frame.width {
            XCTAssertLessThanOrEqual(pageFrame.maxX, navigation.toolbar.frame.minX + 1)
        }
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
        let portraitWidth = app.frame.width
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let frame = app.frame
            return frame.width > frame.height && abs(frame.width - portraitWidth) > 0.5
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [landscape]), .completed)
        try verifyHomePanelsAndNavigationLane(app)

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
        try verifyHomePanelsAndNavigationLane(app)
    }

    /// Compare content-relative positions while scrolling, so larger text cannot pass by clipping lower actions.
    @MainActor
    private func verifyHomePanelsAndNavigationLane(
        _ app: XCUIApplication,
    ) throws {
        let page = UITestConditions.element(app, "home-overview-sections")
        XCTAssertTrue(page.waitForAppearance())
        let navigation = try NavigationUITestConditions.navigationAction(app, "navigation-tab-home")
        XCTAssertTrue(navigation.control.isSelected)
        for identifier in ["home-metric-sleep", "home-metric-heartRate"] {
            let card = UITestConditions.element(app, identifier)
            UITestConditions.scrollTo(card, in: app)
            XCTAssertTrue(card.exists && card.isHittable, identifier)
            if navigation.toolbar.frame.height > navigation.toolbar.frame.width {
                XCTAssertLessThanOrEqual(card.frame.maxX, navigation.toolbar.frame.minX + 1, identifier)
            }
        }
        var previousY: CGFloat = -1
        for identifier in ["home-prepare-visit", "home-metrics-edit", "home-open-symptoms"] {
            let action = UITestConditions.element(app, identifier)
            UITestConditions.scrollTo(action, in: app)
            XCTAssertTrue(action.exists && action.isHittable, identifier)
            XCTAssertGreaterThanOrEqual(action.frame.height, 44, identifier)
            let relativeY = action.frame.minY - page.frame.minY
            XCTAssertGreaterThan(relativeY, previousY, "Home order must remain visit, metrics, symptoms")
            previousY = relativeY
            XCTAssertGreaterThanOrEqual(action.frame.minX, page.frame.minX - 1)
            XCTAssertLessThanOrEqual(action.frame.maxX, page.frame.maxX + 1)
        }
        if navigation.toolbar.frame.height > navigation.toolbar.frame.width {
            XCTAssertLessThanOrEqual(page.frame.maxX, navigation.toolbar.frame.minX + 1,
                                     "Home content must stay outside the measured right navigation lane")
        } else {
            try NavigationUITestConditions.contentAboveBar(
                app,
                scrollID: "navigation-route-scroll",
                contentID: "home-recent-changes",
                navigationID: "navigation-tab-home",
            )
        }
    }
}
