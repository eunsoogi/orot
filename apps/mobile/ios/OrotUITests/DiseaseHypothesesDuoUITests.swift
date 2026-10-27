import XCTest

/// Uses the production AI route with opt-in synthetic evidence and no external dispatch.
final class DiseaseHypothesesDuoUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testDuoReflowPreservesSelectedEvidenceAndSummaryActions() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "ai-feature-visit-questions",
            "-OROT_DISEASE_HYPOTHESES_VISUAL_STATE", "synthetic",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        defer {
            XCUIDevice.shared.orientation = .portrait
            UITestConditions.terminateStandaloneApp(app)
        }

        XCTAssertTrue(UITestConditions.exists(node(app, "welcome-title")))
        try NavigationUITestConditions.openTab(app, "ai", markers: ["ai-features-screen"])
        let entry = node(app, "ai-feature-disease-hypotheses")
        FormUITestConditions.reveal(entry, in: app, scrollID: "ai-features-screen")
        entry.tap()
        NavigationUITestConditions.route(app, markers: ["disease-hypotheses-screen"])

        let summary = node(app, "symptom-summary-generate")
        let assessment = node(app, "disease-hypotheses-generate")
        XCTAssertTrue(UITestConditions.exists(summary))
        XCTAssertTrue(UITestConditions.exists(assessment))
        summary.tap()
        message(app, "합성 증상 요약")
        let citation = app.buttons.matching(
            NSPredicate(format: "label CONTAINS %@", "원문 근거 열기"),
        ).firstMatch
        XCTAssertTrue(UITestConditions.exists(citation))
        XCTAssertTrue(citation.isHittable)
        XCTAssertEqual(citation.label, "원문 근거 열기 · 건강 기록 · 2035-05-20")

        let previousFrame = app.frame
        XCUIDevice.shared.orientation = .landscapeLeft
        let orientationChanged = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                let frame = app.frame
                return !frame.isEmpty && frame.width > frame.height &&
                    (abs(frame.width - previousFrame.width) > 0.5 ||
                        abs(frame.height - previousFrame.height) > 0.5)
            },
            object: nil,
        )
        XCTAssertEqual(UITestConditions.wait(for: [orientationChanged]), .completed)
        NavigationUITestConditions.route(app, markers: ["disease-hypotheses-screen"])
        XCTAssertTrue(UITestConditions.exists(node(app, "disease-hypotheses-columns")))
        XCTAssertTrue(UITestConditions.exists(node(app, "disease-hypotheses-columns-primary")))
        XCTAssertTrue(UITestConditions.exists(node(app, "disease-hypotheses-columns-secondary")))
        message(app, "합성 증상 요약")
        XCTAssertTrue(UITestConditions.exists(citation))
        XCTAssertEqual(citation.label, "원문 근거 열기 · 건강 기록 · 2035-05-20")
        XCTAssertTrue(UITestConditions.exists(summary))
        XCTAssertTrue(UITestConditions.exists(assessment))

        assessment.tap()
        message(app, "합성 가능성 평가")
        XCTAssertTrue(UITestConditions.exists(citation))
        XCTAssertTrue(UITestConditions.exists(summary))

        // This production fixture has empty summary storage but keeps history as a separate route.
        node(app, "symptom-summary-history-open").tap()
        NavigationUITestConditions.route(app, markers: ["summary-history-screen"])
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["저장된 요약이 없어요."]))
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["disease-hypotheses-screen"])
        message(app, "합성 가능성 평가")
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }

    @MainActor
    private func message(_ app: XCUIApplication, _ text: String) {
        let message = app.staticTexts.matching(NSPredicate(format: "label == %@", text)).firstMatch
        XCTAssertTrue(UITestConditions.exists(message), app.debugDescription)
        XCTAssertTrue(message.isHittable, message.debugDescription)
    }
}
