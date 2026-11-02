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

    /// End-of-content clearance is a native scroll boundary, independent of Home action activation.
    @MainActor
    func testHomeContentClearsBottomNavigation() throws {
        let app = XCUIApplication()
        defer {
            app.terminate()
            XCUIDevice.shared.orientation = .portrait
        }
        XCUIDevice.shared.orientation = .portrait
        for category in ["UICTContentSizeCategoryLarge", "UICTContentSizeCategoryAccessibilityXXXL"] {
            app.launchArguments = [
                "-OROT_E2E_PROBE", "medical-appointment-app-navigation",
                "-OROT_HOME_APPOINTMENT_TIMING", "YES",
                "-UIPreferredContentSizeCategoryName", category,
                "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            ]
            app.launch()
            XCTAssertTrue(UITestConditions.element(app, "welcome-title").waitForAppearance())
            try verifyBottomClearance(app)
            if category == "UICTContentSizeCategoryLarge" {
                let portraitWidth = app.frame.width
                XCUIDevice.shared.orientation = .landscapeLeft
                let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                    let frame = app.frame
                    return frame.width > frame.height && abs(frame.width - portraitWidth) > 0.5
                }, object: nil)
                XCTAssertEqual(UITestConditions.wait(for: [landscape]), .completed)
                try verifyBottomClearance(app)
                app.terminate()
                XCUIDevice.shared.orientation = .portrait
            }
        }
    }

    @MainActor
    private func verifyBottomClearance(_ app: XCUIApplication) throws {
        // The endpoint must represent populated content, not an earlier loading layout.
        for identifier in ["home-prepare-visit", "home-metrics-edit", "home-open-symptoms"] {
            XCTAssertTrue(UITestConditions.element(app, identifier).waitForAppearance(), identifier)
        }
        let edit = UITestConditions.element(app, "home-metrics-edit")
        let metricsReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in edit.isEnabled }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [metricsReady]), .completed)
        let navigation = try NavigationUITestConditions.navigationAction(app, "navigation-tab-home")
        if navigation.toolbar.frame.height <= navigation.toolbar.frame.width {
            try NavigationUITestConditions.contentAboveBar(
                app,
                scrollID: "navigation-route-scroll",
                contentID: "home-recent-changes",
                navigationID: "navigation-tab-home",
            )
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
            XCTAssertTrue(card.waitForAppearance())
            // Metric cards have no activation handler; XCTest attempts to reveal the selected element.
            card.tap()
            XCTAssertTrue(card.exists && card.isHittable, identifier)
            if navigation.toolbar.frame.height > navigation.toolbar.frame.width {
                XCTAssertLessThanOrEqual(card.frame.maxX, navigation.toolbar.frame.minX + 1, identifier)
            }
        }
        XCTAssertTrue(navigation.control.isSelected)
        var previousY: CGFloat = -1
        for identifier in ["home-prepare-visit", "home-metrics-edit", "home-open-symptoms"] {
            let action = UITestConditions.element(app, identifier)
            XCTAssertTrue(action.waitForAppearance())
            if identifier == "home-metrics-edit" {
                let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in action.isEnabled }, object: nil)
                XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed)
            }
            // Frames preserve geometry checks independently of automatic target reveal.
            let frame = action.frame
            let pageFrame = page.frame
            XCTAssertFalse(frame.isEmpty, identifier)
            XCTAssertFalse(pageFrame.isEmpty, identifier)
            XCTAssertGreaterThanOrEqual(frame.height, 44, identifier)
            let relativeY = frame.minY - pageFrame.minY
            XCTAssertGreaterThan(relativeY, previousY, "Home order must remain visit, metrics, symptoms")
            previousY = relativeY
            XCTAssertGreaterThanOrEqual(frame.minX, pageFrame.minX - 1)
            XCTAssertLessThanOrEqual(frame.maxX, pageFrame.maxX + 1)
            // XCTest attempts to reveal an offscreen target before the real activation.
            action.tap()
            if identifier == "home-metrics-edit" {
                XCTAssertTrue(app.staticTexts["지표를 2개에서 4개 선택하세요."].waitForAppearance())
                XCTAssertTrue(action.exists && action.isHittable, identifier)
                app.buttons["취소"].tap()
            } else {
                let destination = identifier == "home-prepare-visit" ? "appointment-preparation" : "symptoms-layout"
                NavigationUITestConditions.route(app, markers: [destination])
                try NavigationUITestConditions.navigationAction(app, "navigation-back").control.tap()
                XCTAssertTrue(page.waitForAppearance())
                XCTAssertTrue(try NavigationUITestConditions.navigationAction(app, "navigation-tab-home").control.isSelected)
            }
        }
        if navigation.toolbar.frame.height > navigation.toolbar.frame.width {
            XCTAssertLessThanOrEqual(page.frame.maxX, navigation.toolbar.frame.minX + 1,
                                     "Home content must stay outside the measured right navigation lane")
        }
    }
}
