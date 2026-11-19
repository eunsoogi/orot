import XCTest

/// Exercises current Records and visit-day routes with committed synthetic artifacts.
/// The old conversation-list UI must stay absent; all reads use production owners.
@MainActor
enum GeneratedRecordsRoutesUITestConditions {
    static func inspect(_ app: XCUIApplication, suffix: String, testCase: XCTestCase) throws {
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        let browser = UITestConditions.element(app, "generated-report-browser")
        XCTAssertTrue(UITestConditions.exists(browser))
        // Resolve the control by identifier so reveal can match its actual owning window.
        let open = app.buttons["generated-report-open"]
        XCTAssertEqual(open.label, "보고서·진료 질문 보기")
        try tap(open, in: app)
        let reports = [
            ("summary:synthetic-routes-possibilities", "합성 기록에서 살펴볼 가능성이에요."),
            ("summary:synthetic-routes-health-summary", "합성 건강 정보 요약이에요."),
            ("summary:synthetic-routes-daily-report", "합성 오늘의 보고서예요."),
            ("visit:synthetic-routes-appointment", "합성 건강 기록을 진료에서 확인할까요?"),
        ]
        for (key, text) in reports {
            let row = app.buttons["generated-report-\(key)"]
            XCTAssertTrue(UITestConditions.exists(row), app.debugDescription)
            try tap(row, in: app)
            XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "generated-report-detail")))
            // Match the saved prose itself so the owning window and visible text are both checked.
            let prose = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "generated-report-paragraph-", text)).firstMatch
            XCTAssertTrue(UITestConditions.exists(prose), app.debugDescription)
            try RoutesVisibleContentUITestConditions.prose(prose, expected: text, in: app)
            assertReadOnly(app)
            _ = try NavigationUITestConditions.navigationAction(app, "navigation-tab-records")
            RecordingFixtureUITestConditions.capture(app, "records-\(key.replacingOccurrences(of: ":", with: "-"))-\(suffix)", testCase: testCase)
            let back = app.buttons["generated-report-back"]
            XCTAssertEqual(back.label, "목록으로")
            try tap(back, in: app, towardTop: true)
            XCTAssertFalse(UITestConditions.element(app, "generated-report-detail").exists)
            XCTAssertTrue(UITestConditions.exists(row))
        }
        RecordingFixtureUITestConditions.capture(app, "records-report-list-\(suffix)", testCase: testCase)
        let close = app.buttons["generated-report-close"]
        XCTAssertEqual(close.label, "닫기")
        try tap(close, in: app, towardTop: true)
        XCTAssertTrue(UITestConditions.exists(app.buttons["generated-report-open"]))
        try NavigationUITestConditions.openTab(app, "overview", markers: ["overview-title"])
        try tap(UITestConditions.element(app, "overview-prepare-visit"), in: app)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "visit-day-questions")))
        let question = app.staticTexts["visit-day-question-synthetic-routes-question"]
        XCTAssertTrue(UITestConditions.exists(question), app.debugDescription)
        XCTAssertTrue(question.label.contains("합성 건강 기록을 진료에서 확인할까요?"))
        _ = try XCTUnwrap(FormUITestConditions.reveal(question, in: app, scrollID: "navigation-route-scroll"))
        XCTAssertTrue(question.isHittable)
        assertReadOnly(app)
        _ = try NavigationUITestConditions.navigationAction(app, "navigation-back")
        RecordingFixtureUITestConditions.capture(app, "visit-day-saved-questions-\(suffix)", testCase: testCase)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["overview-title"])
        try NavigationUITestConditions.openTab(app, "conversation", markers: ["rag-conversation-screen"])
        XCTAssertFalse(UITestConditions.element(app, "rag-conversation-sessions-toggle").exists)
    }

    private static func tap(_ target: XCUIElement, in app: XCUIApplication, towardTop: Bool = false) throws {
        _ = try XCTUnwrap(FormUITestConditions.reveal(target, in: app, scrollID: "navigation-route-scroll", towardTop: towardTop))
        XCTAssertTrue(target.isHittable && target.isEnabled)
        target.tap()
    }

    private static func assertReadOnly(_ app: XCUIApplication) {
        for id in ["disease-hypotheses-generate", "next-visit-generate", "inference-disclosure-sheet"] {
            XCTAssertFalse(UITestConditions.element(app, id).exists, app.debugDescription)
        }
    }
}
