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
        XCTAssertFalse(node(app, "inference-disclosure-sheet").exists)
        XCTAssertFalse(node(app, "external-evidence-loading").exists)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["ai-features-screen"])
        try assertActionsFitContentLane(app)
    }

    @MainActor
    private func assertActionsFitContentLane(_ app: XCUIApplication) throws {
        let viewport = node(app, "navigation-content-region")
        let rail = node(app, "navigation-right-rail")
        guard UITestConditions.exists(viewport), !viewport.frame.isEmpty,
              UITestConditions.exists(rail), !rail.frame.isEmpty
        else {
            throw XCTSkip("Duo content-lane geometry is unavailable; this run cannot prove expanded-panel placement.")
        }

        let screen = node(app, "ai-features-screen")
        let columns = node(app, "ai-feature-columns")
        let primary = node(app, "ai-feature-columns-primary")
        let secondary = node(app, "ai-feature-columns-secondary")
        for element in [screen, columns, primary, secondary] {
            XCTAssertTrue(UITestConditions.exists(element), app.debugDescription)
            XCTAssertFalse(element.frame.isEmpty, element.debugDescription)
        }

        XCTAssertLessThanOrEqual(viewport.frame.maxX, rail.frame.minX + 0.5, app.debugDescription)
        // The screen must receive the full shell lane before its own readable fallback is considered.
        // A scene-owned single region is roughly half the Duo lane and fails this ratio check.
        XCTAssertGreaterThanOrEqual(screen.frame.width, viewport.frame.width * 0.75, screen.debugDescription)

        // Match AdaptiveColumns' 320-point readable-column minimum and 24-point gap.
        let minimumColumnWidth: CGFloat = 320
        let columnGap: CGFloat = 24
        let remainingLaneWidth = columns.frame.width - primary.frame.width
        let expandedLayoutRequired = columns.frame.width >= minimumColumnWidth * 2 + columnGap &&
            (primary.frame.width >= minimumColumnWidth * 2 + columnGap ||
                remainingLaneWidth >= minimumColumnWidth + columnGap)
        if expandedLayoutRequired {
            XCTAssertGreaterThanOrEqual(primary.frame.width, minimumColumnWidth, primary.debugDescription)
            XCTAssertGreaterThanOrEqual(secondary.frame.width, minimumColumnWidth, secondary.debugDescription)
            XCTAssertLessThan(primary.frame.maxX, secondary.frame.minX, app.debugDescription)
            XCTAssertLessThanOrEqual(abs(primary.frame.minX - columns.frame.minX), 1, app.debugDescription)
            XCTAssertLessThanOrEqual(abs(secondary.frame.maxX - columns.frame.maxX), 1, app.debugDescription)
        } else {
            // A measured narrow lane or a single wide native region may validly retain one readable column.
            XCTAssertLessThanOrEqual(abs(primary.frame.minX - secondary.frame.minX), 1, app.debugDescription)
            XCTAssertLessThanOrEqual(abs(primary.frame.width - secondary.frame.width), 1, app.debugDescription)
            XCTAssertLessThan(primary.frame.maxY, secondary.frame.minY, app.debugDescription)
        }

        for id in ["visit-questions", "disease-hypotheses", "rag-conversation", "external-evidence"] {
            let action = node(app, "ai-feature-\(id)")
            XCTAssertTrue(UITestConditions.exists(action), app.debugDescription)
            FormUITestConditions.reveal(action, in: app, scrollID: "ai-features-screen")
            XCTAssertTrue(action.isHittable, action.debugDescription)
            XCTAssertGreaterThanOrEqual(action.frame.minX, viewport.frame.minX - 0.5)
            XCTAssertLessThanOrEqual(action.frame.maxX, viewport.frame.maxX + 0.5)
            XCTAssertFalse(action.frame.intersects(rail.frame), action.debugDescription)
        }
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }
}
