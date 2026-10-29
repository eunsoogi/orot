import XCTest

/// Confirms the AI entry actions stay usable inside the measured content lane through a native size change.
final class FeatureEntryDuoUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testFeatureEntryActionsStayWithinContentLaneAfterOrientationChange() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "ai-feature-visit-questions", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer {
            XCUIDevice.shared.orientation = .portrait
            UITestConditions.terminateStandaloneApp(app)
        }
        XCTAssertTrue(UITestConditions.exists(node(app, "welcome-title")))
        try NavigationUITestConditions.openTab(app, "ai", markers: ["ai-features-screen"])

        let visitQuestions = node(app, "ai-feature-visit-questions")
        FormUITestConditions.reveal(visitQuestions, in: app, scrollID: "ai-features-screen")
        visitQuestions.tap()
        NavigationUITestConditions.route(app, markers: ["next-visit-questions-scroll"])
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["ai-features-screen"])

        let originalFrame = app.frame
        try assertActionsFitContentLane(app)

        XCUIDevice.shared.orientation = .landscapeLeft
        let changedFrame = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                let frame = app.frame
                return !frame.isEmpty && frame.width > frame.height &&
                    (abs(frame.width - originalFrame.width) > 0.5 || abs(frame.height - originalFrame.height) > 0.5)
            },
            object: nil,
        )
        XCTAssertEqual(UITestConditions.wait(for: [changedFrame]), .completed, "The active window must report the new orientation")
        NavigationUITestConditions.route(app, markers: ["ai-features-screen"])
        try assertActionsFitContentLane(app)

        let externalEvidence = node(app, "ai-feature-external-evidence")
        FormUITestConditions.reveal(externalEvidence, in: app, scrollID: "ai-features-screen")
        externalEvidence.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "external-medical-evidence-screen")))
        XCTAssertTrue(UITestConditions.exists(node(app, "external-evidence-search")))
        try assertLiteraturePanelsFitContentLane(app)
        XCTAssertFalse(node(app, "inference-disclosure-sheet").exists)
        XCTAssertFalse(node(app, "external-evidence-loading").exists)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["ai-features-screen"])
        try assertActionsFitContentLane(app)
    }

    @MainActor
    private func assertActionsFitContentLane(_ app: XCUIApplication) throws {
        let viewport = node(app, "navigation-content-region")
        // The React marker owns events; UIKit's toolbar owns the rendered rail frame.
        let rail = try NavigationUITestConditions.navigationAction(app, "navigation-tab-ai").toolbar
        guard UITestConditions.exists(viewport), !viewport.frame.isEmpty,
              UITestConditions.exists(node(app, "navigation-right-rail")),
              UITestConditions.exists(rail), !rail.frame.isEmpty
        else {
            XCTFail("Duo content-lane geometry is unavailable; this run cannot prove entry placement.")
            return
        }

        let screen = node(app, "ai-features-screen")
        let columns = node(app, "ai-feature-columns")
        for element in [screen, columns] {
            XCTAssertTrue(UITestConditions.exists(element), app.debugDescription)
            XCTAssertFalse(element.frame.isEmpty, element.debugDescription)
        }

        XCTAssertLessThanOrEqual(viewport.frame.maxX, rail.frame.minX + 0.5, app.debugDescription)
        // The screen must receive the full shell lane before its own readable fallback is considered.
        // A scene-owned single region is roughly half the Duo lane and fails this ratio check.
        XCTAssertGreaterThanOrEqual(screen.frame.width, viewport.frame.width * 0.75, screen.debugDescription)

        // Normalize against the page while scrolling to measure equal real gaps at variable text heights.
        var previousBottom: CGFloat?
        for id in ["visit-questions", "disease-hypotheses", "rag-conversation", "external-evidence"] {
            let action = node(app, "ai-feature-\(id)")
            XCTAssertTrue(UITestConditions.exists(action), app.debugDescription)
            FormUITestConditions.reveal(action, in: app, scrollID: "ai-features-screen")
            XCTAssertTrue(action.isHittable, action.debugDescription)
            XCTAssertGreaterThanOrEqual(action.frame.height, 44)
            let relativeTop = action.frame.minY - columns.frame.minY
            if let previousBottom {
                XCTAssertEqual(relativeTop - previousBottom, 16, accuracy: 1, "Every neighboring entry uses the same point gap")
            }
            previousBottom = action.frame.maxY - columns.frame.minY
            XCTAssertGreaterThanOrEqual(action.frame.minX, viewport.frame.minX - 0.5)
            XCTAssertLessThanOrEqual(action.frame.maxX, viewport.frame.maxX + 0.5)
            XCTAssertFalse(action.frame.intersects(rail.frame), action.debugDescription)
        }
    }

    /// Search and result guidance share one measured lane and one vertical scroll owner.
    @MainActor
    private func assertLiteraturePanelsFitContentLane(_ app: XCUIApplication) throws {
        let viewport = node(app, "navigation-content-region")
        let rail = try NavigationUITestConditions.navigationAction(app, "navigation-tab-ai").toolbar
        let columns = node(app, "external-medical-evidence-columns")
        let primary = node(app, "external-medical-evidence-columns-primary")
        // Missing measured product geometry must fail instead of silently skipping the page.
        guard UITestConditions.exists(viewport), !viewport.frame.isEmpty,
              UITestConditions.exists(rail), !rail.frame.isEmpty
        else {
            XCTFail("Medical-literature content geometry is unavailable in this window.")
            return
        }

        XCTAssertFalse(node(app, "external-medical-evidence-columns-secondary").exists)
        for panel in [columns, primary] {
            XCTAssertTrue(UITestConditions.exists(panel), app.debugDescription)
            XCTAssertFalse(panel.frame.isEmpty, panel.debugDescription)
        }

        for panel in [primary] {
            XCTAssertGreaterThanOrEqual(panel.frame.minX, columns.frame.minX - 0.5)
            XCTAssertLessThanOrEqual(panel.frame.maxX, columns.frame.maxX + 0.5)
            XCTAssertGreaterThanOrEqual(panel.frame.minX, viewport.frame.minX - 0.5)
            XCTAssertLessThanOrEqual(panel.frame.maxX, viewport.frame.maxX + 0.5)
            XCTAssertFalse(panel.frame.intersects(rail.frame), panel.debugDescription)
        }

        XCTAssertEqual(node(app, "external-medical-evidence-screen").scrollViews.count, 1)
        XCTAssertFalse(node(app, "external-evidence-result-panel").exists)
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }
}
