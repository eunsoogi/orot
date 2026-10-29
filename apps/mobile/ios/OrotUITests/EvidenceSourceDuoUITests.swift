import XCTest

/// Exercises the production citation overlay and return route with an opt-in SQLCipher fixture.
final class EvidenceSourceDuoUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// Measures actual disease/source routes independently of keyboard and orientation completion.
    @MainActor
    func testSyntheticSourceSelectionAndReturnKeepContentBoundaries() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "ai-feature-visit-questions",
            "-OROT_EVIDENCE_SOURCE_DUO_VISUAL_STATE", "synthetic",
            "-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryLarge",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        XCTAssertTrue(UITestConditions.exists(node(app, "welcome-title")))
        try NavigationUITestConditions.openTab(app, "ai", markers: ["ai-features-screen"])
        let feature = node(app, "ai-feature-disease-hypotheses")
        XCTAssertTrue(UITestConditions.exists(feature) && feature.isHittable)
        feature.tap()
        NavigationUITestConditions.route(app, markers: ["disease-hypotheses-screen"])
        try NavigationGeometryUITestConditions.captureChildBoundary(app, viewportIDs: ["disease-hypotheses-screen"], name: "disease-entry-content-boundary", testCase: self)
        // The existing fixture seeds only reserved synthetic IDs and returns fixed output without an external model call.
        let generate = node(app, "disease-hypotheses-generate")
        XCTAssertTrue(generate.exists && generate.isHittable)
        generate.tap()
        let citation = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "원문 근거 열기")).firstMatch
        XCTAssertTrue(UITestConditions.exists(citation) && citation.isHittable)
        try NavigationGeometryUITestConditions.captureChildBoundary(app, viewportIDs: ["disease-hypotheses-screen"], name: "disease-result-content-boundary", testCase: self)
        citation.tap()
        NavigationUITestConditions.route(app, markers: ["ai-feature-source-detail"])
        XCTAssertTrue(app.staticTexts["합성 원문 기록: 측정 결과를 저장할 때 남긴 설명입니다."].exists)
        try NavigationGeometryUITestConditions.captureChildBoundary(app, viewportIDs: ["ai-feature-source-detail", "ai-feature-source-detail-columns-primary"], name: "evidence-source-content-boundary", testCase: self)
        let source = node(app, "ai-feature-source-section-1")
        XCTAssertTrue(source.exists && source.isHittable)
        source.tap()
        XCTAssertTrue(source.isSelected)
        XCTAssertTrue(app.staticTexts["합성 저장 기록"].exists)
        try NavigationGeometryUITestConditions.captureChildBoundary(app, viewportIDs: ["ai-feature-source-detail"], name: "evidence-source-selection-boundary", testCase: self)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["disease-hypotheses-screen"])
        XCTAssertTrue(citation.exists && citation.isHittable)
        try NavigationGeometryUITestConditions.captureChildBoundary(app, viewportIDs: ["disease-hypotheses-screen"], name: "disease-source-return-boundary", testCase: self)
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

        let primary = node(app, "ai-feature-source-selection")
        let secondary = node(app, "ai-feature-source-content")
        XCTAssertTrue(UITestConditions.exists(primary), app.debugDescription)
        XCTAssertTrue(UITestConditions.exists(secondary), app.debugDescription)
        XCTAssertGreaterThanOrEqual(secondary.frame.minY, primary.frame.maxY)
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
