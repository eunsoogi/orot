import XCTest

/// Exercises the retained analysis screen with synthetic evidence and no external dispatch.
final class DiseaseHypothesesDuoUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testDuoReflowPreservesSelectedEvidenceAndSummaryActions() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "summary-visual",
            "-OROT_DUO_RETAINED_ANALYSIS", "synthetic",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        defer {
            XCUIDevice.shared.orientation = .portrait
            UITestConditions.terminateStandaloneApp(app)
        }

        XCTAssertTrue(UITestConditions.exists(node(app, "summary-visual-picker")))
        node(app, "summary-visual-open").tap()
        NavigationUITestConditions.route(app, markers: ["disease-hypotheses-screen"])

        NavigationPageActionUITestConditions.assertToolbar(app, marker: "disease-hypotheses-screen", actions: ["symptom-summary-generate", "disease-hypotheses-generate", "navigation-page-action-overflow"])
        NavigationPageActionUITestConditions.tap(app, id: "symptom-summary-generate", label: "증상과 기록 요약하기")
        message(app, "합성 체중 기록은 70.5 kg이에요.")
        let citation = app.buttons.matching(
            NSPredicate(format: "label CONTAINS %@", "원문 근거 열기"),
        ).firstMatch
        XCTAssertTrue(UITestConditions.exists(citation))
        XCTAssertTrue(citation.isHittable)
        XCTAssertEqual(citation.label, "원문 근거 열기 · 건강 기록 · 2026-10-20")

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
        message(app, "합성 체중 기록은 70.5 kg이에요.")
        XCTAssertTrue(UITestConditions.exists(citation))
        XCTAssertEqual(citation.label, "원문 근거 열기 · 건강 기록 · 2026-10-20")
        NavigationPageActionUITestConditions.assertToolbar(app, marker: "disease-hypotheses-screen", actions: ["symptom-summary-generate", "disease-hypotheses-generate", "navigation-page-action-overflow"])

        NavigationPageActionUITestConditions.tap(app, id: "disease-hypotheses-generate", label: "가능성 살펴보기")
        message(app, "합성 가능성 평가")
        XCTAssertTrue(UITestConditions.exists(citation))
        NavigationPageActionUITestConditions.assertToolbar(app, marker: "disease-hypotheses-screen", actions: ["symptom-summary-generate", "disease-hypotheses-generate", "navigation-page-action-overflow"])

        // The synthetic summary was saved separately; viewing history must retain the current assessment.
        NavigationPageActionUITestConditions.tap(app, id: "symptom-summary-history-open", label: "저장된 요약 보기")
        NavigationUITestConditions.route(app, markers: ["summary-history-screen"])
        XCTAssertTrue(UITestConditions.exists(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "합성 요약 모델")).firstMatch))
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
