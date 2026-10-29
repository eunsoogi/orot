import XCTest

extension RootNavigationUITests {
    /// Exercises the production provider overlay without fabricating availability or saving a provider choice.
    @MainActor
    func testProviderSelectionOverlayKeepsUnavailableProviderDisabledAcrossMeasuredDuoReflow() throws {
        let app = XCUIApplication()
        defer {
            app.terminate()
            XCUIDevice.shared.orientation = .portrait
        }

        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = [
            "-OROT_TEST_PROFILE", "core",
            "-OROT_TEST_UI_GEOMETRY", "YES",
            "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        try NavigationUITestConditions.openTab(app, "ai", markers: ["ai-features-screen"])
        tap(app, "ai-feature-select-provider")
        NavigationUITestConditions.route(app, markers: ["provider-selection-screen"])
        try verifyProviderSelectionLayout(app)

        let portraitWidth = app.frame.width
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let frame = app.frame
            return frame.width > frame.height && abs(frame.width - portraitWidth) > 0.5
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [landscape]), .completed, app.debugDescription)
        NavigationUITestConditions.route(app, markers: ["provider-selection-screen"])
        try verifyProviderSelectionLayout(app)
        capture(app, "provider-selection-duo-landscape")

        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["ai-features-screen"])
        XCTAssertTrue(try NavigationUITestConditions.navigationAction(app, "navigation-tab-ai").control.isSelected)
    }

    /// Keeps both provider groups and the disabled action inside the native content region.
    @MainActor
    private func verifyProviderSelectionLayout(_ app: XCUIApplication) throws {
        let prefix = "provider-selection-feature-panels"
        let primary = UITestConditions.element(app, "provider-selection-local-panel")
        let secondary = UITestConditions.element(app, "provider-selection-connected-panel")
        let host = UITestConditions.element(app, "\(prefix)-host")
        XCTAssertTrue(primary.waitForAppearance() && secondary.waitForAppearance() && host.waitForAppearance(), app.debugDescription)

        let capabilities = UITestConditions.element(app, "provider-option-0-capabilities")
        XCTAssertTrue(capabilities.waitForAppearance(), app.debugDescription)
        FormUITestConditions.reveal(capabilities, in: app, scrollID: "provider-selection-screen")
        XCTAssertTrue(capabilities.isHittable, app.debugDescription)
        let unavailableOption = UITestConditions.element(app, "provider-option-0")
        XCTAssertFalse(unavailableOption.isEnabled, "The core test fixture reports Apple Intelligence as unavailable")
        XCTAssertFalse(unavailableOption.isSelected, "An unavailable provider cannot become selected")
        XCTAssertTrue(app.staticTexts["이 기기에서는 Apple Intelligence를 사용할 수 없어요."].exists, app.debugDescription)

        let primaryFrame = primary.frame
        let secondaryFrame = secondary.frame
        XCTAssertTrue(host.frame.insetBy(dx: -1, dy: -1).contains(primaryFrame))
        XCTAssertTrue(host.frame.insetBy(dx: -1, dy: -1).contains(secondaryFrame))
        let stacked = abs(primaryFrame.minX - secondaryFrame.minX) <= 1 && primaryFrame.maxY <= secondaryFrame.minY + 1
        XCTAssertTrue(stacked, "Provider sections must share one vertical page")

        let footer = UITestConditions.element(app, "provider-selection-footer")
        FormUITestConditions.reveal(footer, in: app, scrollID: "provider-selection-screen")
        XCTAssertTrue(footer.exists && footer.isHittable, app.debugDescription)
        let disabledAction = app.buttons["이 AI 사용"]
        XCTAssertTrue(disabledAction.exists && !disabledAction.isEnabled, app.debugDescription)

        let navigation = try NavigationUITestConditions.navigationAction(app, "navigation-back")
        if navigation.toolbar.frame.height > navigation.toolbar.frame.width {
            XCTAssertLessThanOrEqual(max(primaryFrame.maxX, secondaryFrame.maxX), navigation.toolbar.frame.minX + 1)
            XCTAssertLessThanOrEqual(footer.frame.maxX, navigation.toolbar.frame.minX + 1)
        }
    }
}
