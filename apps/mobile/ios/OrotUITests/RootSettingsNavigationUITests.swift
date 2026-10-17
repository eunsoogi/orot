import XCTest

extension RootNavigationUITests {
    /// Keep integration and recovery routes reachable in Settings after removing redundant import flows.
    @MainActor
    func testSettingsKeepsAccountsBackupAndPrivacyOnTheirOwnRoutes() throws {
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
}
