import XCTest

/// Confirms the default conversation stays usable in the Duo lane at large text and in both appearances.
final class FeatureEntryDuoUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testFeatureEntryActionsStayWithinContentLaneAfterOrientationChange() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "ai-feature-visit-questions",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ] + AppearanceUITestConditions.observationArguments
        app.launch()
        var originalAppearance: AppearanceUITestConditions.Snapshot?
        defer {
            XCUIDevice.shared.orientation = .portrait
            if let originalAppearance {
                do {
                    try AppearanceUITestConditions.restore(
                        originalAppearance,
                        returningTo: app,
                        testCase: self,
                    )
                } catch {
                    XCTFail("Could not restore the owned device appearance: \(error)")
                }
            }
            UITestConditions.terminateStandaloneApp(app)
        }
        XCTAssertTrue(UITestConditions.exists(node(app, "welcome-title")))
        _ = try AppearanceUITestConditions.select(
            false,
            returningTo: app,
            testCase: self,
            captureOriginal: { originalAppearance = $0 },
        )
        try NavigationUITestConditions.openTab(app, "ai", markers: ["rag-conversation-screen"])
        try assertConversationFitsContentLane(app)
        NavigationPageActionUITestConditions.tap(app, id: "rag-conversation-sessions-toggle", label: "대화 목록")
        NavigationUITestConditions.route(app, markers: ["conversation-history-screen"])
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["rag-conversation-screen"])
        try assertConversationFitsContentLane(app)

        let originalFrame = app.frame
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
        NavigationUITestConditions.route(app, markers: ["rag-conversation-screen"])
        try assertConversationFitsContentLane(app)

        _ = try AppearanceUITestConditions.select(
            true,
            returningTo: app,
            testCase: self,
            captureOriginal: {
                if originalAppearance == nil {
                    originalAppearance = $0
                }
            },
        )
        NavigationUITestConditions.route(app, markers: ["rag-conversation-screen"])
        try assertConversationFitsContentLane(app)
    }

    /// Measures the actual conversation lane and rail targets in each observed window state.
    @MainActor
    private func assertConversationFitsContentLane(_ app: XCUIApplication) throws {
        let viewport = node(app, "navigation-content-region")
        let rail = try NavigationUITestConditions.navigationAction(app, "navigation-tab-ai").toolbar
        let screen = node(app, "rag-conversation-screen")
        let input = node(app, "rag-conversation-input")
        for element in [viewport, rail, screen, input] {
            XCTAssertTrue(UITestConditions.exists(element), app.debugDescription)
            XCTAssertFalse(element.frame.isEmpty, element.debugDescription)
        }
        XCTAssertTrue(UITestConditions.exists(node(app, "navigation-right-rail")))
        XCTAssertLessThanOrEqual(viewport.frame.maxX, rail.frame.minX + 0.5, app.debugDescription)
        XCTAssertGreaterThanOrEqual(screen.frame.width, viewport.frame.width * 0.75, screen.debugDescription)
        XCTAssertGreaterThanOrEqual(input.frame.minX, viewport.frame.minX - 0.5)
        XCTAssertLessThanOrEqual(input.frame.maxX, viewport.frame.maxX + 0.5)
        XCTAssertTrue(input.isHittable, input.debugDescription)
        XCTAssertFalse(input.frame.intersects(rail.frame), input.debugDescription)

        let history = node(app, "rag-conversation-sessions-toggle")
        let newSession = node(app, "rag-conversation-new-session")
        // Context actions have their own native toolbar alongside the root-tab toolbar.
        let pageToolbar = node(app, "navigation-page-action-toolbar")
        XCTAssertTrue(UITestConditions.exists(pageToolbar), app.debugDescription)
        XCTAssertFalse(pageToolbar.frame.isEmpty, pageToolbar.debugDescription)
        for (action, label) in [(history, "대화 목록"), (newSession, "새 대화")] {
            XCTAssertTrue(UITestConditions.exists(action) && action.isHittable, app.debugDescription)
            XCTAssertTrue(action.label.contains(label), action.debugDescription)
            XCTAssertGreaterThanOrEqual(action.frame.width, 44)
            XCTAssertGreaterThanOrEqual(action.frame.height, 44)
            XCTAssertTrue(pageToolbar.frame.insetBy(dx: -1, dy: -1).contains(action.frame), action.debugDescription)
            XCTAssertGreaterThanOrEqual(action.frame.minX, viewport.frame.maxX - 0.5)
        }
        XCTAssertLessThan(history.frame.minY, newSession.frame.minY, "Duo keeps history before new conversation")
        XCTAssertFalse(history.frame.intersects(newSession.frame))
        XCTAssertFalse(node(app, "ai-features-screen").exists)
        XCTAssertFalse(node(app, "external-evidence-search").exists)
        XCTAssertFalse(node(app, "inference-disclosure-sheet").exists)
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }
}
