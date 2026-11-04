import XCTest

/// Shares the manual-history launch configuration across persistence and sheet journeys.
enum ManualHistoryUITestSupport {
    @MainActor
    static func launch(_ app: XCUIApplication, largeText: Bool = false, scenario: String? = nil, observeAppearance: Bool = false, observeGeometry: Bool = false, initialDate: String? = nil) {
        app.launchArguments = [
            scenario == nil ? "-OROT_TEST_PROFILE" : "-OROT_TEST_SCENARIO",
            scenario ?? "core", "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ] + (largeText ? ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] : [])
            + (observeAppearance ? AppearanceUITestConditions.observationArguments : [])
            + (observeGeometry ? ["-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES"] : [])
            + (initialDate.map { ["-OROT_TEST_MANUAL_HISTORY_DATE", $0] } ?? [])
        app.launch()
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
    }
}

/// Uses the real UIKit calendar; the test build fixes only the initial month.
enum ManualHistoryDateSheetUITestSupport {
    @MainActor
    static func exerciseDismissalsAndSelect(_ app: XCUIApplication, day: Int) {
        open(app)
        // open(_:) just established that this same control was hittable before presentation.
        XCTAssertFalse(UITestConditions.element(app, "manual-history-open-date-picker").isHittable, app.debugDescription)
        tapDay(app, day)
        app.buttons["manual-history-date-cancel"].tap()
        XCTAssertTrue(UITestConditions.element(app, "manual-history-open-date-picker").label.contains("달력에서 날짜 선택"))
        open(app)
        tapDay(app, day)
        let navigation = app.navigationBars["기준일"]
        XCTAssertTrue(UITestConditions.exists(navigation), app.debugDescription)
        let start = navigation.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.95))
        start.press(forDuration: 0.1, thenDragTo: end)
        XCTAssertTrue(UITestConditions.element(app, "manual-history-open-date-picker").isHittable, app.debugDescription)
        XCTAssertTrue(UITestConditions.element(app, "manual-history-open-date-picker").label.contains("달력에서 날짜 선택"))
        select(app, day: day)
    }

    @MainActor
    static func select(_ app: XCUIApplication, day: Int) {
        open(app)
        tapDay(app, day)
        let done = app.buttons["manual-history-date-done"]
        XCTAssertTrue(UITestConditions.exists(done), app.debugDescription)
        done.tap()
    }

    @MainActor
    private static func open(_ app: XCUIApplication) {
        let button = UITestConditions.element(app, "manual-history-open-date-picker")
        FormUITestConditions.reveal(button, in: app, scrollID: "manual-history-scroll")
        XCTAssertTrue(button.isHittable, app.debugDescription)
        button.tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-native-date-picker")), app.debugDescription)
    }

    @MainActor
    private static func tapDay(_ app: XCUIApplication, _ day: Int) {
        let picker = UITestConditions.element(app, "manual-history-native-date-picker")
        let predicate = NSPredicate(format: "label == %@ OR label CONTAINS[c] %@", String(day), "February \(day)")
        let date = picker.buttons.matching(predicate).firstMatch
        XCTAssertTrue(UITestConditions.exists(date) && date.isHittable, app.debugDescription)
        date.tap()
    }
}
