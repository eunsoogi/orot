import XCTest

/// Exercises the actual chart consumers using only the existing synthetic test entries.
final class ChartConsumerAcceptanceUITests: OrotFailFastTestCase {
    /// The value list must remain reachable at the largest accessibility text size.
    @MainActor
    func testHomeLargeTextChartValuesRemainReachable() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        app.launchArguments = [
            "-OROT_E2E_PROBE", "medical-appointment-app-navigation",
            "-OROT_HOME_APPOINTMENT_TIMING", "YES",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
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
        // Scope the shared guidance to this card; the other Home metric has the same text.
        let notice = NSPredicate(format: "label == %@", "큰 글자에서는 아래 목록으로 값을 확인하세요.")
        let listNotice = try XCTUnwrap(HomeMetricGeometryConditions.texts(matching: notice, in: chart, app: app).first)
        let scroll = homeScroll.scrollViews.firstMatch
        XCTAssertTrue(scroll.exists)
        UITestConditions.scrollTo(listNotice, in: scroll)
        XCTAssertTrue(listNotice.exists && listNotice.isHittable, app.debugDescription)
        let recorded = NSPredicate(format: "label MATCHES %@", #"\d{4}-\d{2}-\d{2}: [0-9].*출처:.*"#)
        let value = try XCTUnwrap(HomeMetricGeometryConditions.texts(matching: recorded, in: chart, app: app).first)
        UITestConditions.scrollTo(value, in: scroll)
        XCTAssertTrue(value.exists && value.isHittable, value.debugDescription)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "home-large-text-chart-list"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    /// Actual speech must expose both saved pressure values and the secondary series label.
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
        let chart = UITestConditions.element(app, "health-record-chart-values-blood_pressure")
        XCTAssertTrue(chart.waitForAppearance(), app.debugDescription)
        let scroll = UITestConditions.element(app, "health-records-scroll").scrollViews.firstMatch
        XCTAssertTrue(scroll.exists, app.debugDescription)
        for (label, expected, phase) in [
            ("121 mmHg", "121", "systolic-value"),
            ("이완기 (점선)", "이완기", "diastolic-series"),
            ("79 mmHg", "79", "diastolic-value"),
        ] {
            // VoiceOver can change the viewport; reveal each real target after enabling it.
            let target = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", label)).firstMatch
            if !XCUIDevice.shared.voiceOverService.isEnabled {
                try XCUIDevice.shared.voiceOverService.enable()
            }
            UITestConditions.scrollTo(target, in: scroll)
            try voiceOver.assertSpeech(from: target, expected: expected, forbiddenTerms: [], phase: phase, testCase: self)
        }
    }
}
