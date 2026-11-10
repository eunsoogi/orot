import XCTest

/// Exercises the synthetic shared chart through native touch and actual VoiceOver speech.
final class ChartFoundationUITests: OrotFailFastTestCase {
    @MainActor
    func testDenseChartPagesAndVoiceOverValues() throws {
        guard #available(iOS 27.0, *) else {
            XCTFail("This test requires the iOS 27 VoiceOver service")
            return
        }
        let app = XCUIApplication()
        let voiceOver = VoiceOverTestSession()
        voiceOver.registerRestoration(in: self)
        try voiceOver.prepareForStandardInteraction()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "chart-foundation"]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }

        // Start with a visible actual value: enabling VoiceOver resets this fixture's viewport.
        let pressure = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "120 mmHg")).firstMatch
        try voiceOver.assertSpeech(from: pressure, expected: "120", forbiddenTerms: [], phase: "chart-value", testCase: self)
        try voiceOver.prepareForStandardInteraction()

        let scroll = app.scrollViews.firstMatch
        let next = UITestConditions.element(app, "dense-health-chart-next")
        UITestConditions.scrollTo(next, in: scroll)
        XCTAssertTrue(next.exists && next.isHittable, next.debugDescription)
        guard next.exists, next.isHittable else { return }
        let page = UITestConditions.element(app, "dense-health-chart-page")
        XCTAssertEqual(page.label, "1 / 3쪽")
        let started = Date()
        next.tap()
        XCTAssertEqual(page.label, "2 / 3쪽")
        print("CHART_PAGE_TAP_SECONDS \(Date().timeIntervalSince(started))")
        XCTAssertTrue(next.exists && next.isHittable, next.debugDescription)
        next.tap()
        XCTAssertEqual(page.label, "3 / 3쪽")

        let outlier = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "199회/분")).firstMatch
        UITestConditions.scrollTo(outlier, in: scroll)
        XCTAssertTrue(outlier.exists && outlier.isHittable, outlier.debugDescription)
    }
}
