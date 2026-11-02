import XCTest

extension RootNavigationUITests {
    /// Uses XCTest's target-based reveal to observe large-text reachability without a repeated drag journey.
    @MainActor
    func testSettingsLargeTextTargetsRemainReachableBesideDuoRail() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "settings-accounts-layout",
            "-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        defer { app.terminate() }
        NavigationUITestConditions.route(app, markers: ["settings-title"])

        let sync = app.buttons.matching(identifier: "settings-open-sync-status")
        XCTAssertEqual(sync.count, 1, "The fixture must expose one sync status action")
        let target = sync.firstMatch
        XCTAssertTrue(target.exists)
        // This fixture's sync callback is a no-op; a tap cannot start synchronization.
        target.tap()
        XCTAssertTrue(target.isHittable, "The revealed action must have a native hit point")
        let viewport = UITestConditions.element(app, "navigation-route-scroll")
        let rail = try NavigationUITestConditions.navigationAction(app, "navigation-tab-settings").toolbar
        let frame = target.frame
        XCTAssertTrue(viewport.exists && frame.intersects(viewport.frame))
        XCTAssertGreaterThanOrEqual(frame.width, 44)
        XCTAssertGreaterThanOrEqual(frame.height, 44)
        XCTAssertGreaterThan(rail.frame.height, rail.frame.width, "This observation requires the Duo rail")
        XCTAssertLessThanOrEqual(frame.maxX, rail.frame.minX)
        capture(app, "settings-large-text-sync-revealed")

        // App information is static: capture its actual rendering without asserting an action.
        let info = UITestConditions.element(app, "settings-app-info")
        XCTAssertTrue(info.exists)
        info.tap()
        let infoFrame = info.frame
        XCTAssertTrue(infoFrame.intersects(viewport.frame))
        XCTAssertLessThanOrEqual(infoFrame.maxX, rail.frame.minX)
        let infoText = app.staticTexts.matching(identifier: "settings-app-info-text")
        guard infoText.count == 1 else {
            XCTFail("Expected exactly one app information text, found \(infoText.count)")
            return
        }
        let textFrame = infoText.element(boundBy: 0).frame
        XCTAssertTrue(infoFrame.intersects(textFrame))
        XCTAssertTrue(viewport.frame.contains(textFrame), "The app information text must fit in the visible viewport")
        // The attachment still needs visual review; accessibility frames alone cannot establish rendered text.
        capture(app, "settings-large-text-app-info-revealed")
    }

    /// Preserves the Settings panel and accessibility checks when rotation is unavailable.
    @MainActor
    func testSettingsPortraitLayoutAndLargeText() throws {
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        defer { app.terminate() }
        let arguments = ["-OROT_TEST_PROFILE", "core", "-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launchArguments = arguments
        app.launch()
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        let regularTitleHeight = UITestConditions.element(app, "settings-title").frame.height
        try verifySettingsPanels(app)
        FormUITestConditions.reveal(UITestConditions.element(app, "settings-open-health-data"), in: app, scrollID: "navigation-route-scroll")
        tap(app, "settings-open-health-data")
        NavigationUITestConditions.route(app, markers: ["health-data-title"])
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["settings-title"])
        XCTAssertTrue(try NavigationUITestConditions.navigationAction(app, "navigation-tab-settings").control.isSelected)
        app.terminate()
        app.launchArguments = arguments + ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        XCTAssertGreaterThan(UITestConditions.element(app, "settings-title").frame.height, regularTitleHeight)
        try verifySettingsPanels(app, expectsStacked: true)
        try NavigationUITestConditions.scrollToBottom(app, "navigation-route-scroll")
        XCTAssertTrue(UITestConditions.element(app, "settings-open-backup").isHittable)
        capture(app, "settings-duo-portrait-large-text")
    }
}
