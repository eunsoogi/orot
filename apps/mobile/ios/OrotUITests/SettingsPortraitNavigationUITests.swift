import XCTest

extension RootNavigationUITests {
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
