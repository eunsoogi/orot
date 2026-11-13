import XCTest

/// The sender is synthetic; navigation, protected storage and app lifecycle are real.
@MainActor
final class ConversationRetentionUITests: OrotFailFastTestCase {
    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "conversation-retention", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        return app
    }

    private func observe(_ app: XCUIApplication, _ expected: String) {
        app.buttons["retention-probe-refresh"].tap()
        let label = app.staticTexts["retention-probe-status"]
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", expected), object: label)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 10), .completed, label.debugDescription)
    }

    private func send(_ app: XCUIApplication) {
        let input = UITestConditions.element(app, "rag-conversation-input")
        XCTAssertTrue(UITestConditions.exists(input) && input.isHittable)
        input.tap()
        input.typeText("Synthetic retention question")
        XCTAssertEqual(input.value as? String, "Synthetic retention question")
        app.buttons["rag-conversation-send"].tap()
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["Synthetic partial response"]))
    }

    /// The keyboard can move the real conversation header above its scroll viewport.
    private func conversationAction(_ app: XCUIApplication, id: String, label: String) {
        let target = UITestConditions.element(app, id)
        if target.exists {
            XCTAssertNotNil(FormUITestConditions.reveal(target, in: app, scrollID: "rag-conversation-history", towardTop: true))
        }
        let action = NavigationPageActionUITestConditions.pageAction(app, id: id, label: label)
        XCTAssertTrue(action.exists && action.isHittable, app.debugDescription)
        XCTAssertGreaterThanOrEqual(action.frame.width, 44)
        XCTAssertGreaterThanOrEqual(action.frame.height, 44)
        action.tap()
    }

    /// Background and restart use real iOS lifecycle transitions, without a real model.
    func testStreamSurvivesNavigationBackgroundAndRestoresAfterRestart() {
        let app = launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        send(app)
        observe(app, "dispatches:1 completions:0 previews:1 interrupted:0")
        app.buttons["retention-probe-tab"].tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "retention-probe-other-tab")))
        app.buttons["retention-probe-tab"].tap()
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["Synthetic partial response"]))
        conversationAction(app, id: "rag-conversation-sessions-toggle", label: "대화 목록")
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "conversation-history-screen")))
        app.buttons["navigation-back"].tap()
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["Synthetic partial response"]))
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["Synthetic partial response"]))
        observe(app, "dispatches:1 completions:0 previews:1 interrupted:0")
        app.terminate()
        app.launch()
        observe(app, "dispatches:1 completions:0 previews:1 interrupted:1")
        conversationAction(app, id: "rag-conversation-sessions-toggle", label: "대화 목록")
        let row = UITestConditions.element(app, "conversation-history-session-2")
        XCTAssertTrue(UITestConditions.exists(row))
        row.tap()
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["Synthetic partial response"]))
        XCTAssertTrue(app.staticTexts["Synthetic retention question"].exists)
        XCTAssertFalse(app.buttons["rag-conversation-cancel"].exists)
        observe(app, "dispatches:1 completions:0 previews:1 interrupted:1")
    }

    /// Completing while another session is visible must commit exactly one identity.
    func testCompletionCommitsOnceWhileAnotherConversationIsVisible() {
        let app = launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        send(app)
        observe(app, "dispatches:1 completions:0 previews:1 interrupted:0")
        conversationAction(app, id: "rag-conversation-new-session", label: "새 대화")
        app.buttons["retention-probe-release"].tap()
        observe(app, "dispatches:1 completions:1 previews:0 interrupted:0")
        XCTAssertFalse(app.staticTexts["Synthetic committed response"].exists)
        conversationAction(app, id: "rag-conversation-sessions-toggle", label: "대화 목록")
        let original = UITestConditions.element(app, "conversation-history-session-1")
        XCTAssertTrue(UITestConditions.exists(original))
        original.tap()
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["Synthetic committed response"]))
        observe(app, "dispatches:1 completions:1 previews:0 interrupted:0")
    }
}
