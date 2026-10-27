import XCTest

extension RootNavigationUITests {
    /// Exercises the production provider overlay through real window reflow without committing a provider choice.
    @MainActor
    func testProviderSelectionOverlayReflowsWithinMeasuredDuoRegionsAndKeepsConfirmationReachable() throws {
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

        let capabilities = UITestConditions.element(app, "provider-option-0-capabilities")
        XCTAssertTrue(capabilities.waitForAppearance(), app.debugDescription)
        FormUITestConditions.reveal(
            capabilities,
            in: app,
            scrollID: "provider-selection-screen",
        )
        XCTAssertTrue(capabilities.isHittable)
        try verifyProviderSelectionLayout(app)

        let pendingChoice = app.buttons.matching(identifier: "provider-option-0").firstMatch
        XCTAssertTrue(pendingChoice.waitForAppearance() && pendingChoice.isHittable, app.debugDescription)
        pendingChoice.tap()
        XCTAssertTrue(pendingChoice.isSelected, "The in-flow choice becomes pending before confirmation")
        let initialConfirmation = app.buttons.matching(identifier: "provider-selection-confirm").firstMatch
        XCTAssertTrue(initialConfirmation.exists && initialConfirmation.isEnabled && initialConfirmation.isHittable, app.debugDescription)

        let portraitWidth = app.frame.width
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let frame = app.frame
            return frame.width > frame.height && abs(frame.width - portraitWidth) > 0.5
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [landscape]), .completed, app.debugDescription)
        NavigationUITestConditions.route(app, markers: ["provider-selection-screen"])
        try verifyProviderSelectionLayout(app)
        let reflowedChoice = app.buttons.matching(identifier: "provider-option-0").firstMatch
        XCTAssertTrue(reflowedChoice.exists && reflowedChoice.isSelected, "Reflow keeps the pending provider choice")
        let reflowedConfirmation = app.buttons.matching(identifier: "provider-selection-confirm").firstMatch
        XCTAssertTrue(reflowedConfirmation.exists && reflowedConfirmation.isEnabled && reflowedConfirmation.isHittable, app.debugDescription)
        capture(app, "provider-selection-duo-landscape")

        // Clear the uncommitted choice before leaving so this geometry check never changes provider state.
        let cancelPendingChoice = app.buttons.matching(identifier: "provider-selection-cancel").firstMatch
        XCTAssertTrue(cancelPendingChoice.isHittable, app.debugDescription)
        cancelPendingChoice.tap()
        XCTAssertFalse(UITestConditions.element(app, "provider-selection-confirmation").exists)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["ai-features-screen"])
        XCTAssertTrue(try NavigationUITestConditions.navigationAction(app, "navigation-tab-ai").control.isSelected)
    }

    /// Keeps both provider groups and the fixed, explicit action inside the native content region.
    @MainActor
    private func verifyProviderSelectionLayout(_ app: XCUIApplication) throws {
        let prefix = "provider-selection-feature-panels"
        let primary = UITestConditions.element(app, "\(prefix)-primary")
        let secondary = UITestConditions.element(app, "\(prefix)-secondary")
        let host = UITestConditions.element(app, "\(prefix)-host")
        XCTAssertTrue(primary.waitForAppearance() && secondary.waitForAppearance() && host.waitForAppearance(), app.debugDescription)

        let primaryFrame = primary.frame
        let secondaryFrame = secondary.frame
        XCTAssertTrue(host.frame.insetBy(dx: -1, dy: -1).contains(primaryFrame))
        XCTAssertTrue(host.frame.insetBy(dx: -1, dy: -1).contains(secondaryFrame))
        let columns = abs(primaryFrame.minY - secondaryFrame.minY) <= 1 && primaryFrame.maxX <= secondaryFrame.minX + 1
        let stacked = abs(primaryFrame.minX - secondaryFrame.minX) <= 1 && primaryFrame.maxY <= secondaryFrame.minY + 1
        XCTAssertTrue(columns || stacked, "Provider panels must use one readable column or two measured columns")

        let footer = UITestConditions.element(app, "provider-selection-footer")
        XCTAssertTrue(footer.exists && footer.isHittable, app.debugDescription)

        let navigation = try NavigationUITestConditions.navigationAction(app, "navigation-back")
        if navigation.toolbar.frame.height > navigation.toolbar.frame.width {
            XCTAssertLessThanOrEqual(max(primaryFrame.maxX, secondaryFrame.maxX), navigation.toolbar.frame.minX + 1)
            XCTAssertLessThanOrEqual(footer.frame.maxX, navigation.toolbar.frame.minX + 1)
        }
    }
}
