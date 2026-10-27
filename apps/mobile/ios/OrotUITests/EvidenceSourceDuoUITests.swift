import XCTest

/// Exercises the production citation overlay and return route with an opt-in SQLCipher fixture.
final class EvidenceSourceDuoUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testEvidenceSourceDetailsReflowWithoutLosingReturnState() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "ai-feature-visit-questions",
            "-OROT_EVIDENCE_SOURCE_DUO_VISUAL_STATE", "synthetic",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        defer {
            XCUIDevice.shared.orientation = .portrait
            UITestConditions.terminateStandaloneApp(app)
        }

        XCTAssertTrue(UITestConditions.exists(node(app, "welcome-title")))
        try NavigationUITestConditions.openTab(app, "ai", markers: ["ai-features-screen"])
        let feature = node(app, "ai-feature-disease-hypotheses")
        FormUITestConditions.reveal(feature, in: app, scrollID: "ai-features-screen")
        feature.tap()
        NavigationUITestConditions.route(app, markers: ["disease-hypotheses-screen"])

        node(app, "disease-hypotheses-generate").tap()
        let citation = app.buttons.matching(
            NSPredicate(format: "label CONTAINS %@", "원문 근거 열기"),
        ).firstMatch
        XCTAssertTrue(UITestConditions.exists(citation), app.debugDescription)
        citation.tap()

        XCTAssertTrue(UITestConditions.exists(node(app, "ai-feature-source-detail")))
        XCTAssertTrue(app.staticTexts["합성 원문 기록: 측정 결과를 저장할 때 남긴 설명입니다."].exists)
        let sourceTab = node(app, "ai-feature-source-section-1")
        XCTAssertTrue(UITestConditions.exists(sourceTab), app.debugDescription)
        sourceTab.tap()
        XCTAssertTrue(app.staticTexts["합성 저장 기록"].exists)

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

        let primary = node(app, "ai-feature-source-detail-columns-primary")
        let secondary = node(app, "ai-feature-source-detail-columns-secondary")
        XCTAssertTrue(UITestConditions.exists(primary), app.debugDescription)
        XCTAssertTrue(UITestConditions.exists(secondary), app.debugDescription)
        XCTAssertGreaterThan(secondary.frame.minX, primary.frame.maxX)
        XCTAssertTrue(app.staticTexts["합성 저장 기록"].exists)

        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["disease-hypotheses-screen"])
        XCTAssertTrue(UITestConditions.exists(citation), app.debugDescription)
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }
}
