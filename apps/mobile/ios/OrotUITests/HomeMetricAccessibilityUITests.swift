import XCTest

extension HomeDuoUITests {
    /// Reads native Home labels from synthetic health records; source attribution remains internal.
    @MainActor
    @objc
    func testHomeMetricAccessibleLabelsLocalizeUnitsAndHideAttribution() {
        let app = XCUIApplication()
        defer { app.terminate() }
        app.launchArguments = [
            "-OROT_E2E_PROBE", "medical-appointment-app-navigation",
            "-OROT_HOME_APPOINTMENT_TIMING", "YES",
            "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR",
        ]
        app.launch()

        let page = UITestConditions.element(app, "home-overview-sections")
        XCTAssertTrue(page.waitForAppearance(), app.debugDescription)
        let edit = UITestConditions.element(app, "home-metrics-edit")
        let metricsReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in edit.isEnabled }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [metricsReady]), .completed)

        for (identifier, unit) in [("home-metric-sleep", "분"), ("home-metric-heartRate", "회/분")] {
            let card = UITestConditions.element(app, identifier)
            XCTAssertTrue(card.waitForAppearance(), app.debugDescription)
            let label = card.label
            XCTAssertTrue(label.contains(unit), label)
            XCTAssertFalse(label.contains("min"), label)
            XCTAssertFalse(label.contains("count/min"), label)
            XCTAssertFalse(label.contains("Synthetic Watch"), label)
            XCTAssertFalse(label.contains(TimeZone.current.identifier), label)
        }
    }
}
