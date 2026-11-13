import XCTest

/// Verifies the rendered saved-result routes on the current Duo window without requesting rotation.
final class ConversationHistoryDuoUITests: OrotFailFastTestCase {
    /// Checks actual titles, button hit targets, and saved-route navigation without starting a provider or rotating.
    @MainActor
    func testSavedOutputActionsOpenAndReturnFromHistory() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "ai-feature-visit-questions", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }

        XCTAssertTrue(UITestConditions.exists(node(app, "welcome-title")))
        try NavigationUITestConditions.openTab(app, "ai", markers: ["rag-conversation-screen"])
        NavigationPageActionUITestConditions.tap(app, id: "rag-conversation-sessions-toggle", label: "대화 목록")
        NavigationUITestConditions.route(app, markers: ["conversation-history-screen"])

        let page = node(app, "conversation-history-page")
        let title = node(app, "conversation-history-title")
        let count = node(app, "conversation-history-count")
        let savedOutputsTitle = node(app, "conversation-history-saved-outputs-title")
        XCTAssertTrue(UITestConditions.exists(page))
        XCTAssertTrue(UITestConditions.exists(title) && title.isHittable)
        XCTAssertTrue(UITestConditions.exists(count))
        XCTAssertTrue(UITestConditions.exists(savedOutputsTitle))
        XCTAssertEqual(title.label, "대화 기록")
        XCTAssertEqual(savedOutputsTitle.label, "저장된 AI 결과")
        XCTAssertLessThan(title.frame.minY, count.frame.minY)
        XCTAssertLessThan(count.frame.minY, savedOutputsTitle.frame.minY)

        let savedAnalysis = node(app, "conversation-saved-analysis")
        let savedVisitQuestions = node(app, "conversation-saved-visit-questions")
        XCTAssertTrue(savedAnalysis.exists && savedAnalysis.isHittable && savedAnalysis.isEnabled, app.debugDescription)
        XCTAssertTrue(savedVisitQuestions.exists && savedVisitQuestions.isHittable && savedVisitQuestions.isEnabled, app.debugDescription)
        XCTAssertLessThan(savedAnalysis.frame.minY, savedVisitQuestions.frame.minY)
        XCTAssertGreaterThanOrEqual(savedAnalysis.frame.width, 44)
        XCTAssertGreaterThanOrEqual(savedAnalysis.frame.height, 44)
        XCTAssertTrue(savedAnalysis.label.contains("저장된 요약과 가능성"), savedAnalysis.debugDescription)
        XCTAssertTrue(savedAnalysis.label.contains("다시 살펴봐요"), savedAnalysis.debugDescription)
        XCTAssertTrue(page.frame.contains(savedAnalysis.frame), app.debugDescription)
        savedAnalysis.tap()
        NavigationUITestConditions.route(app, markers: ["disease-hypotheses-screen"])
        XCTAssertFalse(node(app, "disease-hypotheses-generate").exists)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["conversation-history-screen"])

        XCTAssertGreaterThanOrEqual(savedVisitQuestions.frame.width, 44)
        XCTAssertGreaterThanOrEqual(savedVisitQuestions.frame.height, 44)
        XCTAssertTrue(savedVisitQuestions.label.contains("저장된 진료 질문"), savedVisitQuestions.debugDescription)
        XCTAssertTrue(savedVisitQuestions.label.contains("다시 살펴봐요"), savedVisitQuestions.debugDescription)
        XCTAssertTrue(page.frame.contains(savedVisitQuestions.frame), app.debugDescription)
        savedVisitQuestions.tap()
        NavigationUITestConditions.route(app, markers: ["saved-visit-questions-screen"])
        XCTAssertFalse(node(app, "next-visit-generate").exists)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["conversation-history-screen"])
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["rag-conversation-screen"])
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        UITestConditions.element(app, identifier)
    }
}
