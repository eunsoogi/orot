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
        XCTAssertFalse(UITestConditions.element(app, "calendar-connect").exists)
        let month = UITestConditions.element(app, "calendar-month-title")
        let loadedFixtureMonth = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == %@", "2035년 6월"),
            object: month,
        )
        XCTAssertEqual(XCTWaiter.wait(for: [loadedFixtureMonth], timeout: 5), .completed, app.debugDescription)
        UITestConditions.value(month, equals: "2035년 6월")
        FormUITestConditions.reveal(month, in: app, scrollID: "calendar-screen")
        let day = UITestConditions.element(app, "calendar-day-2035-06-02")
        UITestConditions.value(day, equals: "2035년 6월 2일, 합성 외래 방문")
        capture(app, "calendar-seven-column-grid")
        tap(app, "calendar-day-2035-06-02")
        let candidate = UITestConditions.element(app, "calendar-candidate-calendar-synthetic-clinic")
        XCTAssertTrue(candidate.waitForAppearance(), app.debugDescription)
        XCTAssertFalse(UITestConditions.element(app, "calendar-candidate-calendar-synthetic-unrelated").exists)
        tap(app, "calendar-candidate-calendar-synthetic-clinic")
        tap(app, "calendar-confirm-selected")
        let confirmation = UITestConditions.element(app, "calendar-confirm-selected")
        let absent = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !confirmation.exists }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [absent]), .completed, app.debugDescription)
        let title = UITestConditions.element(app, "calendar-next-visit-title")
        UITestConditions.value(title, equals: "합성 외래 방문")
        FormUITestConditions.reveal(title, in: app, scrollID: "calendar-screen")
        let time = UITestConditions.element(app, "calendar-next-visit-time")
        UITestConditions.value(time, equals: "2035년 6월 2일 09:00–10:00 · Asia/Seoul")
        let navigationBar = UITestConditions.element(app, "navigation-action-bar-overlay")
        let scrollView = UITestConditions.element(app, "calendar-screen")
        // The floating toolbar overlays the scroll view, so verify its trailing inset exposes the final appointment detail.
        for _ in 0 ..< 6 {
            if time.frame.maxY <= navigationBar.frame.minY {
                break
            }
            scrollView.swipeUp()
        }
        XCTAssertLessThanOrEqual(time.frame.maxY, navigationBar.frame.minY, app.debugDescription)
        XCTAssertTrue(time.isHittable, app.debugDescription)
        capture(app, "calendar-selected-appointment")
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ identifier: String) {
        let target = UITestConditions.element(app, identifier)
        XCTAssertTrue(target.waitForAppearance(), app.debugDescription)
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
