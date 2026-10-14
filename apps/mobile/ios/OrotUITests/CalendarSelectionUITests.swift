import XCTest

/// The native fixture never reads EventKit. This journey proves explicit selection, layout and local confirmation only.
final class CalendarSelectionUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testOnlyTheSelectedSyntheticEventIsConfirmedFromTheScheduleTab() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        app.launchArguments = ["-OROT_TEST_SCENARIO", "calendar", "-OROT_CALENDAR_PROBE", "synthetic", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        UITestConditions.value(UITestConditions.element(app, "welcome-title"), equals: "오롯")
        XCTAssertFalse(UITestConditions.element(app, "calendar-connect").exists)
        try NavigationUITestConditions.openTab(app, "schedule", markers: ["calendar-title"])
        UITestConditions.value(UITestConditions.element(app, "calendar-title"), equals: "일정")
        let scene = UITestConditions.element(app, "navigation-route-scene-route-1")
        XCTAssertTrue(scene.exists && !scene.frame.isEmpty)
        for identifier in ["calendar-screen", "calendar-title"] {
            let target = UITestConditions.element(app, identifier)
            XCTAssertTrue(target.exists && !target.frame.isEmpty)
            XCTAssertGreaterThanOrEqual(target.frame.minY - scene.frame.minY, 44)
        }
        capture(app, "calendar-top-safe-area")
        XCTAssertFalse(UITestConditions.element(app, "appointment-add").exists)
        tap(app, "calendar-connect")
        let month = UITestConditions.element(app, "calendar-month-title")
        UITestConditions.value(month, equals: "2035년 6월")
        FormUITestConditions.reveal(month, in: app, scrollID: "calendar-screen")
        let day = UITestConditions.element(app, "calendar-day-2035-06-02")
        UITestConditions.value(day, equals: "2035년 6월 2일, 합성 외래 방문")
        capture(app, "calendar-seven-column-grid")
        tap(app, "calendar-day-2035-06-02")
        let candidate = UITestConditions.element(app, "calendar-candidate-calendar-synthetic-clinic")
        XCTAssertTrue(candidate.waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertFalse(UITestConditions.element(app, "calendar-candidate-calendar-synthetic-unrelated").exists)
        tap(app, "calendar-candidate-calendar-synthetic-clinic")
        tap(app, "calendar-confirm-selected")
        let confirmation = UITestConditions.element(app, "calendar-confirm-selected")
        let absent = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !confirmation.exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [absent], timeout: 30), .completed, app.debugDescription)
        let title = UITestConditions.element(app, "calendar-next-visit-title")
        UITestConditions.value(title, equals: "합성 외래 방문")
        FormUITestConditions.reveal(title, in: app, scrollID: "calendar-screen")
        UITestConditions.value(UITestConditions.element(app, "calendar-next-visit-time"), equals: "2035년 6월 2일 09:00–10:00 · Asia/Seoul")
        capture(app, "calendar-selected-appointment")
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ identifier: String) {
        let target = UITestConditions.element(app, identifier)
        XCTAssertTrue(target.waitForExistence(timeout: 30), app.debugDescription)
        FormUITestConditions.reveal(target, in: app, scrollID: "calendar-screen")
        target.tap()
    }

    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
