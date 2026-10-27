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
    }

    @MainActor
    private func assertActionsFitContentLane(_ app: XCUIApplication) throws {
        let viewport = node(app, "navigation-content-region")
        XCTAssertTrue(UITestConditions.exists(viewport) && !viewport.frame.isEmpty, app.debugDescription)
        let rail = node(app, "navigation-right-rail")
        if rail.exists {
            XCTAssertFalse(rail.frame.isEmpty, app.debugDescription)
            XCTAssertLessThanOrEqual(viewport.frame.maxX, rail.frame.minX + 0.5, app.debugDescription)
        }
        for id in ["visit-questions", "disease-hypotheses", "rag-conversation", "external-evidence"] {
            let action = node(app, "ai-feature-\(id)")
            XCTAssertTrue(UITestConditions.exists(action), app.debugDescription)
            FormUITestConditions.reveal(action, in: app, scrollID: "ai-features-screen")
            XCTAssertTrue(action.isHittable, action.debugDescription)
            XCTAssertGreaterThanOrEqual(action.frame.minX, viewport.frame.minX - 0.5)
            XCTAssertLessThanOrEqual(action.frame.maxX, viewport.frame.maxX + 0.5)
            if rail.exists {
                XCTAssertFalse(action.frame.intersects(rail.frame), action.debugDescription)
            }
        }
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }
}
