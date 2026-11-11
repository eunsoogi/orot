import XCTest

/// Exercises the actual chart consumers using only the existing synthetic test entries.
final class ChartConsumerAcceptanceUITests: OrotFailFastTestCase {
    /// The plot and one exact selected measurement remain reachable at XXXL on both iPhone layouts.
    @MainActor
    func testHomeLargeTextChartValuesRemainReachable() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        app.launchArguments = [
            "-OROT_E2E_PROBE", "medical-appointment-app-navigation",
            "-OROT_HOME_APPOINTMENT_TIMING", "YES",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            "-UIUserInterfaceStyle", "Light",
            "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR",
        ]
        app.launch()
        XCTAssertTrue(UITestConditions.element(app, "welcome-title").waitForAppearance())
        let navigation = try NavigationUITestConditions.navigationAction(app, "navigation-tab-home")
        let homeScroll = UITestConditions.element(app, "navigation-route-scroll")
        let card = UITestConditions.element(app, "home-metric-sleep")
        XCTAssertTrue(card.waitForAppearance())
        HomeMetricScrollUITestConditions.revealCard(
            card, in: app, homeScroll: homeScroll, navigationOcclusion: navigation.toolbar,
        )
        XCTAssertTrue(card.exists && card.isHittable, card.debugDescription)
        HomeMetricGeometryConditions.captureCard(card, in: app, testCase: self)
        let chart = UITestConditions.element(app, "home-metric-chart-sleep")
        XCTAssertTrue(chart.exists, app.debugDescription)
        XCTAssertGreaterThan(chart.frame.height, 250, "Large text must retain space for the native plot")
        XCTAssertFalse(app.staticTexts["큰 글자에서는 아래 목록으로 값을 확인하세요."].exists)
        let scroll = homeScroll.scrollViews.firstMatch
        XCTAssertTrue(scroll.exists)
        let selected = UITestConditions.element(app, "home-metric-chart-sleep-selected-point")
        UITestConditions.scrollTo(selected, in: scroll)
        XCTAssertTrue(selected.exists && selected.isHittable, selected.debugDescription)
        XCTAssertTrue(selected.label.contains("출처: 건강 기록"), selected.label)
        let dateCount = (try? NSRegularExpression(pattern: #"\d{4}-\d{2}-\d{2}"#))?
            .numberOfMatches(in: selected.label, range: NSRange(selected.label.startIndex..., in: selected.label)) ?? 0
        XCTAssertEqual(dateCount, 1, selected.label)
        let previous = UITestConditions.element(app, "home-metric-chart-sleep-selected-point-previous")
        XCTAssertTrue(previous.exists && previous.isHittable, previous.debugDescription)
        let initialLabel = selected.label
        previous.tap()
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in selected.label != initialLabel }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [changed]), .completed, selected.debugDescription)
        XCTAssertNotEqual(selected.label, initialLabel)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "home-large-text-selected-chart-detail"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    /// Actual speech exposes provenance and both saved pressure values while the plot uses dark colors.
    @MainActor
    func testBloodPressureValuesAndDiastolicVoiceOver() throws {
        guard #available(iOS 27.0, *) else {
            XCTFail("The VoiceOver speech service requires iOS 27")
            return
        }
        let app = XCUIApplication()
        let voiceOver = VoiceOverTestSession()
        voiceOver.registerRestoration(in: self)
        try voiceOver.prepareForStandardInteraction()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "blood-pressure-visual",
            "-UIUserInterfaceStyle", "Dark",
            "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR",
        ]
        app.launch()
        defer { app.terminate() }
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        try HealthRecordsBoundaryUITestConditions.tap(
            app, identifier: "records-open-health-library",
            owners: [.init(identifier: "navigation-route-scroll")], testCase: self,
        )
        try HealthRecordsBoundaryUITestConditions.tap(
            app, identifier: "health-record-filter-blood_pressure",
            owners: [.init(identifier: "health-records-scroll"), .init(identifier: "health-record-category-filter", horizontal: true)],
            testCase: self,
        )
        let chart = UITestConditions.element(app, "health-record-chart-blood_pressure")
        XCTAssertTrue(chart.waitForAppearance(), app.debugDescription)
        let scroll = UITestConditions.element(app, "health-records-scroll").scrollViews.firstMatch
        XCTAssertTrue(scroll.exists, app.debugDescription)
        UITestConditions.scrollTo(chart, in: scroll)
        XCTAssertTrue(chart.label.contains("2026년"), chart.label)
        XCTAssertTrue(chart.label.contains("121 mmHg"), chart.label)
        XCTAssertTrue(chart.label.contains("79 mmHg"), chart.label)
        XCTAssertTrue(chart.label.contains("디자인 검증용 데이터"), chart.label)
        let darkCapture = XCTAttachment(screenshot: app.screenshot())
        darkCapture.name = "blood-pressure-selected-chart-dark"
        darkCapture.lifetime = .keepAlways
        add(darkCapture)

        try voiceOver.assertSpeech(
            from: chart,
            expected: "121",
            forbiddenTerms: [],
            phase: "selected-systolic-value",
            testCase: self,
        )
        try voiceOver.assertSpeech(
            from: chart,
            expected: "79",
            forbiddenTerms: [],
            phase: "selected-diastolic-value",
            testCase: self,
        )

        try voiceOver.assertSpeech(
            from: chart,
            expected: "디자인 검증용 데이터",
            forbiddenTerms: [],
            phase: "selected-source",
            testCase: self,
        )

        let initialLabel = chart.label
        // An adjustable VoiceOver element changes with a one-finger downward swipe.
        chart.swipeDown()
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in chart.label != initialLabel }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [changed]), .completed, chart.debugDescription)
        XCTAssertTrue(chart.label.contains("122 mmHg"), chart.label)
        XCTAssertTrue(chart.label.contains("78 mmHg"), chart.label)
        try voiceOver.assertSpeech(
            from: chart,
            expected: "122",
            forbiddenTerms: [],
            phase: "previous-selected-systolic-value",
            testCase: self,
        )
    }
}
