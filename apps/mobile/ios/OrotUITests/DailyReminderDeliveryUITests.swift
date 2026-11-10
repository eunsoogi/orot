import XCTest

/// The operator first schedules a near-future daily reminder on a disposable installation.
/// This observes the real system banner and tap, not a simulated notification response.
@MainActor
final class DailyReminderDeliveryUITests: XCTestCase {
    func testScheduledDailyReminderOpensPreparationFromSystemBanner() throws {
        let environment = ProcessInfo.processInfo.environment
        try XCTSkipUnless(environment["OROT_DAILY_REMINDER_DELIVERY_TEST"] == "YES",
                          "Requires an allocated disposable installation with a near-future daily reminder")
        let mode = try XCTUnwrap(environment["OROT_DAILY_REMINDER_DELIVERY_MODE"])
        XCTAssertTrue(mode == "warm" || mode == "cold", "Choose the warm or cold process boundary")
        guard mode == "warm" || mode == "cold" else { return }

        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        let status = UITestConditions.element(app, "settings-daily-reminder-status")
        UITestConditions.scrollTo(status, in: app.scrollViews.firstMatch)
        XCTAssertTrue(UITestConditions.exists(status), app.debugDescription)
        let text = UITestConditions.text(status)
        XCTAssertTrue(text.contains("알림을 예약했어요"), status.debugDescription)
        guard text.contains("알림을 예약했어요") else { return }
        attach(app, name: "daily-reminder-scheduled")

        if mode == "cold" { app.terminate() } else { XCUIDevice.shared.press(.home) }
        let expected: XCUIApplication.State = mode == "cold" ? .notRunning : .runningBackground
        let background = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in app.state == expected }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [background]), .completed)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let notification = springboard.staticTexts["오늘의 기록을 확인해 보세요."]
        // Wait for the actual delivered UI and its hit target; no clock change or injected tap is used.
        let delivered = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            notification.exists && notification.isHittable
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [delivered]), .completed)
        guard notification.exists && notification.isHittable else { return }
        attach(springboard, name: "daily-reminder-system-banner")
        notification.tap()
        let foreground = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in app.state == .runningForeground }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [foreground]), .completed)
        let report = UITestConditions.element(app, "daily-report-screen")
        XCTAssertTrue(UITestConditions.exists(report), app.debugDescription)
        attach(app, name: "daily-reminder-preparation")
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
