import XCTest

/// Exercises the synthetic shared chart through native touch and actual VoiceOver speech.
final class ChartFoundationUITests: OrotFailFastTestCase {
    /// Confirms SVG descendants retain touch and render after native prop updates and remount.
    @MainActor
    func testSVGPropertyUpdatesAndRemount() {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "svg-foundation"]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        let toggle = app.buttons["변경 및 복원"]
        let remount = app.buttons["다시 생성"]
        XCTAssertTrue(toggle.exists && toggle.isHittable)
        let initial = XCTAttachment(screenshot: app.screenshot())
        initial.name = "svg-initial"
        initial.lifetime = .keepAlways
        add(initial)
        toggle.tap()
        XCTAssertTrue(app.staticTexts["상태: 변경 / 적중: 0"].exists)
        let changed = XCTAttachment(screenshot: app.screenshot())
        changed.name = "svg-changed"
        changed.lifetime = .keepAlways
        add(changed)
        let svg = app.otherElements["svg-foundation"]
        XCTAssertTrue(svg.exists && svg.isHittable, svg.debugDescription)
        svg.coordinate(withNormalizedOffset: CGVector(dx: 170.0 / 320.0, dy: 105.0 / 240.0)).tap()
        XCTAssertTrue(app.staticTexts["상태: 변경 / 적중: 1"].exists)
        toggle.tap()
        XCTAssertTrue(app.staticTexts["상태: 기본 / 적중: 1"].exists)
        remount.tap()
        XCTAssertTrue(app.staticTexts["상태: 기본 / 적중: 1"].exists)
        let remounted = XCTAttachment(screenshot: app.screenshot())
        remounted.name = "svg-remounted"
        remounted.lifetime = .keepAlways
        add(remounted)
    }

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
        verifyDenseChartPages(in: app)
    }

    /// Preserve the paging and outlier oracle when the host cannot return VoiceOver speech.
    @MainActor
    func testDenseChartPagesKeepOutlierReachable() {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "chart-foundation"]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        verifyDenseChartPages(in: app)
    }

    @MainActor
    private func verifyDenseChartPages(in app: XCUIApplication) {
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
