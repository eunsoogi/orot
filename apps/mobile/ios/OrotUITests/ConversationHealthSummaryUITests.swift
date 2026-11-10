import XCTest

/// Production conversation components with synthetic result and source data; no model or database is exercised.
final class ConversationHealthSummaryUITests: OrotFailFastTestCase {
    /// Exercises the actual card, keyboard, source return and retry at the largest text size.
    @MainActor
    func testSyntheticSummaryCardSourceRetryAndVoiceOver() throws {
        guard #available(iOS 27.0, *) else {
            XCTFail("The summary VoiceOver observation requires the public iOS 27 service")
            return
        }
        let app = XCUIApplication()
        let voiceOver = VoiceOverTestSession()
        voiceOver.registerRestoration(in: self)
        try voiceOver.prepareForStandardInteraction()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "conversation-visual",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR",
        ]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        let input = UITestConditions.element(app, "rag-conversation-input")
        let send = app.buttons.matching(identifier: "rag-conversation-send").firstMatch
        let history = UITestConditions.element(app, "rag-conversation-history")
        XCTAssertTrue(UITestConditions.exists(input) && input.isHittable)
        input.tap()
        input.typeText("summary-probe")
        XCTAssertEqual(input.value as? String, "summary-probe")
        ConversationComposerDockUITestConditions.waitForVisibleKeyboard(in: app)
        XCTAssertTrue(send.isHittable)
        send.tap()
        let period = UITestConditions.element(app, "health-summary-period")
        let incomplete = UITestConditions.element(app, "health-summary-incomplete")
        let omitted = UITestConditions.element(app, "health-summary-omitted")
        XCTAssertTrue(UITestConditions.exists(period) && UITestConditions.exists(incomplete) && UITestConditions.exists(omitted))
        XCTAssertTrue(period.label.contains("Asia/Seoul"))
        let retry = app.buttons.matching(identifier: "health-summary-retry").firstMatch
        XCTAssertTrue(UITestConditions.exists(retry))
        FormUITestConditions.reveal(retry, in: app, scroll: history, requireHittable: true)
        XCTAssertTrue(retry.exists && retry.isHittable)
        retry.tap()
        let saved = UITestConditions.element(app, "health-summary-save-status")
        XCTAssertTrue(UITestConditions.exists(saved))
        XCTAssertTrue(saved.label.contains("저장됨"))
        let source = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "원문 근거 열기")).firstMatch
        XCTAssertTrue(UITestConditions.exists(source))
        FormUITestConditions.reveal(source, in: app, scroll: history, requireHittable: true)
        XCTAssertTrue(source.exists && source.isHittable)
        source.tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "ai-feature-source-detail")))
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "health-summary-card")))
        let restoredSource = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "원문 근거 열기")).firstMatch
        FormUITestConditions.reveal(restoredSource, in: app, scroll: history, requireHittable: true)
        try voiceOver.assertSpeech(from: restoredSource, expected: "원문 근거 열기", forbiddenTerms: ["HealthKit"], phase: "summary-source", testCase: self)
    }
}
