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
        try verifyHomePanelsAndNavigationLane(app)
        let largeTextPreparation = app.buttons.matching(identifier: "home-prepare-visit").firstMatch
        UITestConditions.scrollTo(largeTextPreparation, in: app)
        largeTextPreparation.tap()
        NavigationUITestConditions.route(app, markers: ["next-visit-questions-scroll"])
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        let recording = UITestConditions.element(app, "home-new-recording")
        UITestConditions.scrollTo(recording, in: app)
        XCTAssertTrue(recording.exists && recording.isHittable)
        recording.tap()
        NavigationUITestConditions.route(app, markers: ["recording-controls-scroll"])
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        try NavigationUITestConditions.tapNavigation(app, "navigation-tab-home")
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        let symptoms = UITestConditions.element(app, "home-open-symptoms")
        UITestConditions.scrollTo(symptoms, in: app)
        symptoms.tap()
        NavigationUITestConditions.route(app, markers: ["symptoms-layout"])
        XCTAssertTrue(UITestConditions.element(app, "symptom-synthetic-home-active-description").exists)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        let recent = UITestConditions.element(app, "home-recent-recording")
        UITestConditions.scrollTo(recent, in: app)
        recent.tap()
        NavigationUITestConditions.route(app, markers: ["records-title"])
        try NavigationUITestConditions.tapNavigation(app, "navigation-tab-home")
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
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
        var previousY: CGFloat = -1
        for identifier in ["home-prepare-visit", "home-open-symptoms", "home-recent-recording", "home-new-recording"] {
            let action = UITestConditions.element(app, identifier)
            UITestConditions.scrollTo(action, in: app)
            XCTAssertTrue(action.exists && action.isHittable, identifier)
            XCTAssertGreaterThanOrEqual(action.frame.height, 44, identifier)
            let relativeY = action.frame.minY - page.frame.minY
            XCTAssertGreaterThan(relativeY, previousY, "Home order must remain visit, symptoms, recent audio, capture")
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
                contentID: "home-new-recording",
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
