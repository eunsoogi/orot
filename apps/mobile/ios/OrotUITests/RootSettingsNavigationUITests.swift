import XCTest

extension RootNavigationUITests {
    /// Verifies Settings panels follow live Duo geometry without moving route actions or the right navigation lane.
    @MainActor
    func testSettingsLayoutTracksMeasuredDuoSpaceAndLargeText() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_PROFILE", "core",
            "-OROT_TEST_UI_GEOMETRY", "YES",
            "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ] + AppearanceUITestConditions.observationArguments
        app.launch()
        var appearanceSnapshot: AppearanceUITestConditions.Snapshot?
        var regularTitleHeight: CGFloat = 0
        defer {
            if let appearanceSnapshot, app.state == .runningForeground {
                do {
                    try AppearanceUITestConditions.restore(
                        appearanceSnapshot,
                        returningTo: app,
                        testCase: self,
                    )
                } catch {
                    XCTFail("Could not restore the original system appearance: \(error)")
                }
            }
            app.terminate()
            XCUIDevice.shared.orientation = .portrait
        }

        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        regularTitleHeight = UITestConditions.element(app, "settings-title").frame.height
        try verifySettingsPanels(app)

        appearanceSnapshot = try AppearanceUITestConditions.select(
            true,
            returningTo: app,
            testCase: self,
        )
        try verifySettingsPanels(app)
        if let snapshot = appearanceSnapshot {
            try AppearanceUITestConditions.restore(
                snapshot,
                returningTo: app,
                testCase: self,
            )
            appearanceSnapshot = nil
        }

        let portraitWidth = app.frame.width
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let frame = app.frame
            return frame.width > frame.height && abs(frame.width - portraitWidth) > 0.5
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [landscape]), .completed)
        try verifySettingsPanels(app)

        XCUIDevice.shared.orientation = .portrait
        let portrait = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let frame = app.frame
            return frame.height > frame.width && abs(frame.width - portraitWidth) <= 0.5
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [portrait]), .completed)
        try verifySettingsPanels(app)

        FormUITestConditions.reveal(
            UITestConditions.element(app, "settings-open-health-data"),
            in: app,
            scrollID: "navigation-route-scroll",
        )
        tap(app, "settings-open-health-data")
        NavigationUITestConditions.route(app, markers: ["health-data-title"])
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["settings-title"])
        XCTAssertTrue(try NavigationUITestConditions.navigationAction(app, "navigation-tab-settings").control.isSelected)

        app.terminate()
        app.launchArguments = [
            "-OROT_TEST_PROFILE", "core",
            "-OROT_TEST_UI_GEOMETRY", "YES",
            "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        XCTAssertGreaterThan(
            UITestConditions.element(app, "settings-title").frame.height,
            regularTitleHeight,
            "The native title must reflect the requested large text size",
        )
        try verifySettingsPanels(app, expectsStacked: true)
        try NavigationUITestConditions.scrollToBottom(app, "navigation-route-scroll")
        XCTAssertTrue(UITestConditions.element(app, "settings-open-backup").isHittable)
        capture(app, "settings-duo-large-text")
    }

    /// Keep integration and recovery routes reachable in Settings after removing redundant import flows.
    @MainActor
    func verifySettingsRoutes() throws {
        let app = launch()
        defer { app.terminate() }
        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        for identifier in ["settings-open-health-data", "settings-open-sync-status", "settings-open-provider", "settings-open-accounts", "settings-open-privacy", "settings-open-backup"] {
            let control = app.buttons[identifier]
            XCTAssertTrue(control.exists && control.isHittable)
        }
        capture(app, "settings-root-light")

        tap(app, "settings-open-health-data")
        NavigationUITestConditions.route(app, markers: ["health-data-title"])
        let medication = UITestConditions.element(app, "health-data-feature-medications")
        XCTAssertTrue(medication.exists && medication.isHittable)
        XCTAssertGreaterThanOrEqual(medication.frame.height, 44)
        XCTAssertFalse(app.buttons["unified-import-start"].exists)
        capture(app, "settings-health-data-light")
        try backToSettings(app)
        tap(app, "settings-open-sync-status")
        NavigationUITestConditions.route(app, markers: ["settings-sync-status-title"])
        XCTAssertTrue(UITestConditions.element(app, "settings-sync-status-message").exists)
        XCTAssertTrue(UITestConditions.element(app, "settings-calendar-sync-section").exists)
        let calendarAccess = UITestConditions.element(app, "settings-calendar-request-access")
        FormUITestConditions.reveal(calendarAccess, in: app, scrollID: "settings-sync-status-scroll")
        XCTAssertTrue(calendarAccess.isHittable)
        XCTAssertTrue(UITestConditions.element(app, "settings-sync-retry").exists)
        XCTAssertTrue(UITestConditions.element(app, "settings-sync-open-system-settings").isHittable)
        capture(app, "settings-sync-status-light")
        try backToSettings(app)

        tap(app, "settings-open-accounts")
        NavigationUITestConditions.route(app, markers: ["settings-accounts-screen"])
        XCTAssertTrue(app.staticTexts["연결된 계정"].exists)
        XCTAssertTrue(UITestConditions.element(app, "chatgpt-account-setup").exists)
        try backToSettings(app)
        tap(app, "settings-open-backup")
        NavigationUITestConditions.route(app, markers: ["settings-backup-title"])
        XCTAssertTrue(UITestConditions.element(app, "backup-status-message").isHittable)
        XCTAssertTrue(UITestConditions.element(app, "backup-prepare").isHittable)
        try NavigationUITestConditions.contentAboveBar(app, scrollID: "settings-backup-scroll", contentID: "backup-open-system-settings")
        XCTAssertTrue(UITestConditions.element(app, "backup-open-system-settings").isHittable)
        capture(app, "settings-backup-light")
        try backToSettings(app)
        tap(app, "settings-open-privacy")
        NavigationUITestConditions.route(app, markers: ["settings-privacy-title"])
        for title in ["마이크", "음성 인식", "건강 앱", "캘린더"] {
            XCTAssertTrue(app.staticTexts[title].exists)
        }
        try NavigationUITestConditions.contentAboveBar(app, scrollID: "settings-privacy-scroll", contentID: "privacy-open-system-settings")
        XCTAssertTrue(UITestConditions.element(app, "privacy-open-system-settings").isHittable)
        capture(app, "settings-privacy-light")
        try backToSettings(app)
    }

    /// Keeps the account panel assertion on the synthetic route and its measured return path.
    @MainActor
    func testSettingsAccountsLayoutTracksMeasuredPanels() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        app.launchArguments = ["-OROT_TEST_SCENARIO", "settings-accounts-layout", "-OROT_TEST_UI_GEOMETRY", "YES"]
        app.launch()
        NavigationUITestConditions.route(app, markers: ["settings-title"])
        tap(app, "settings-open-accounts")
        try verifyAdaptivePanels(app, prefix: "settings-accounts-panels", navigationID: "navigation-back")
        try backToSettings(app)
        XCTAssertTrue(try NavigationUITestConditions.navigationAction(app, "navigation-tab-settings").control.isSelected)
    }

    /// Keeps a pending provider selection through measured native reflow and the original confirmation return.
    @MainActor
    func testSettingsProviderLayoutTracksMeasuredPanels() throws {
        let app = XCUIApplication()
        defer {
            app.terminate()
            XCUIDevice.shared.orientation = .portrait
        }
        app.launchArguments = ["-OROT_TEST_SCENARIO", "settings-provider-layout", "-OROT_TEST_UI_GEOMETRY", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        NavigationUITestConditions.route(app, markers: ["settings-title"])
        tap(app, "settings-open-provider")
        NavigationUITestConditions.route(app, markers: ["settings-provider-screen"])
        tap(app, "settings-provider-load-models")
        let option = UITestConditions.element(app, "provider-option-1")
        XCTAssertTrue(option.waitForAppearance())
        FormUITestConditions.reveal(option, in: app, scrollID: "settings-provider-screen")
        option.tap()
        XCTAssertTrue(option.isSelected)
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in app.frame.width > app.frame.height }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [landscape]), .completed)
        XCTAssertTrue(option.isSelected, "A pending provider choice must survive native reflow")
        try verifyAdaptivePanels(app, prefix: "settings-provider-panels", navigationID: "navigation-back")
        tap(app, "provider-selection-confirm")
        NavigationUITestConditions.route(app, markers: ["settings-title"])
        XCTAssertTrue(app.staticTexts["Synthetic settings model (ChatGPT plan)"].exists)
        XCTAssertTrue(try NavigationUITestConditions.navigationAction(app, "navigation-tab-settings").control.isSelected)
    }

    /// Compares rendered Settings panels with each other and the active native navigation surface.
    @MainActor
    private func verifySettingsPanels(_ app: XCUIApplication, expectsStacked: Bool = false) throws {
        let stacked = try verifyAdaptivePanels(app, prefix: "settings-layout", navigationID: "navigation-tab-settings")
        let navigation = try NavigationUITestConditions.navigationAction(app, "navigation-tab-settings")
        XCTAssertTrue(navigation.control.isSelected)
        if expectsStacked || navigation.toolbar.frame.height > navigation.toolbar.frame.width {
            XCTAssertEqual(stacked, expectsStacked, "Settings panels must match the active text and usable width")
        }
        if navigation.toolbar.frame.height <= navigation.toolbar.frame.width {
            try NavigationUITestConditions.contentAboveBar(
                app,
                scrollID: "navigation-route-scroll",
                contentID: "settings-app-info",
                navigationID: "navigation-tab-settings",
            )
        }

        for identifier in ["settings-open-health-data", "settings-open-sync-status", "settings-open-provider", "settings-open-accounts", "settings-open-privacy", "settings-open-backup"] {
            let control = app.buttons[identifier]
            XCTAssertTrue(control.exists && control.frame.height >= 44)
        }
        XCTAssertTrue(UITestConditions.element(app, "settings-app-info").exists)
    }
}

extension RootNavigationUITests {
    /// Confirms panel axes, host containment, and clearance from the active navigation rail.
    @MainActor
    private func verifyAdaptivePanels(_ app: XCUIApplication, prefix: String, navigationID: String) throws -> Bool {
        let panels = ["primary", "secondary", "host"].map { UITestConditions.element(app, "\(prefix)-\($0)") }
        XCTAssertTrue(panels.allSatisfy { $0.waitForAppearance() })
        let primaryFrame = panels[0].frame, secondaryFrame = panels[1].frame
        let hostFrame = panels[2].frame.insetBy(dx: -1, dy: -1)
        XCTAssertTrue(hostFrame.contains(primaryFrame) && hostFrame.contains(secondaryFrame))
        let columns = abs(primaryFrame.minY - secondaryFrame.minY) <= 1 && primaryFrame.maxX <= secondaryFrame.minX + 1
        let stacked = abs(primaryFrame.minX - secondaryFrame.minX) <= 1 && primaryFrame.maxY <= secondaryFrame.minY + 1
        XCTAssertNotEqual(columns, stacked, "Panels must classify as exactly columns or stacked")
        let toolbar = try NavigationUITestConditions.navigationAction(app, navigationID).toolbar
        guard toolbar.frame.height > toolbar.frame.width else { return stacked }
        XCTAssertLessThanOrEqual(max(primaryFrame.maxX, secondaryFrame.maxX), toolbar.frame.minX + 1)
        return stacked
    }
}
