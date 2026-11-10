import XCTest

/// Opt in only on a disposable production installation with no configured provider or personal data.
@MainActor
final class DailyReportEntryUITests: XCTestCase {
    func testDailyEntryAndConversationDateSurviveRestart() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["OROT_DAILY_REPORT_PRODUCTION_UI"] == "YES",
                          "Requires an explicitly allocated, empty production Simulator installation")
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.orot.mobile")
        app.launch()
        defer { app.terminate() }

        let homeEntry = UITestConditions.element(app, "home-open-daily-report")
        XCTAssertTrue(homeEntry.waitForAppearance(), app.debugDescription)
        attach(app, name: "daily-report-home-entry")
        XCTAssertTrue(homeEntry.isHittable, homeEntry.debugDescription)
        homeEntry.tap()
        XCTAssertTrue(UITestConditions.element(app, "daily-report-screen").waitForAppearance(), app.debugDescription)

        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        XCTAssertTrue(homeEntry.waitForAppearance(), app.debugDescription)
        try NavigationUITestConditions.openTab(app, "ai", markers: ["rag-conversation-screen"])
        let conversationEntry = UITestConditions.element(app, "daily-report-request")
        XCTAssertTrue(conversationEntry.waitForAppearance(), app.debugDescription)
        attach(app, name: "daily-report-conversation-entry")
        XCTAssertTrue(conversationEntry.isHittable, conversationEntry.debugDescription)
        conversationEntry.tap()
        let date = UITestConditions.element(app, "daily-report-date")
        XCTAssertTrue(date.waitForAppearance(), app.debugDescription)
        let originalDate = UITestConditions.text(date)
        XCTAssertFalse(originalDate.isEmpty, date.debugDescription)
        attach(app, name: "daily-report-before-restart")

        // Relaunch the same installation without a fixture reset so Keychain must retain the entry.
        app.terminate()
        app.launch()
        let restoredDate = UITestConditions.element(app, "daily-report-date")
        XCTAssertTrue(restoredDate.waitForAppearance(), app.debugDescription)
        XCTAssertEqual(UITestConditions.text(restoredDate), originalDate, app.debugDescription)
        attach(app, name: "daily-report-after-restart")
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "\(name)-accessibility"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
    }
}
