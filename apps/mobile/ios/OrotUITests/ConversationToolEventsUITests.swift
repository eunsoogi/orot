import XCTest

/// Synthetic event summaries exercise the real conversation screen without model, storage, or source-opening claims.
final class ConversationToolEventsUITests: OrotFailFastTestCase {
    /// Checks separate native hit targets and independent disclosure for two calls in one transcript.
    @MainActor
    func testSyntheticToolCallsExpandIndependentlyWithNativeTargets() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "conversation-visual",
            "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR",
        ]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }

        let input = UITestConditions.element(app, "rag-conversation-input")
        let history = UITestConditions.element(app, "rag-conversation-history")
        let send = app.buttons.matching(identifier: "rag-conversation-send").firstMatch
        XCTAssertTrue(UITestConditions.exists(input) && input.isHittable)
        XCTAssertTrue(UITestConditions.exists(history))
        input.tap()
        input.typeText("tool-events-probe")
        XCTAssertEqual(input.value as? String, "tool-events-probe")
        ConversationComposerDockUITestConditions.waitForVisibleKeyboard(in: app)
        XCTAssertTrue(send.isHittable)
        send.tap()

        let completed = app.buttons.matching(
            identifier: "rag-tool-event-conversation-visual-tool-events-tool-1-toggle",
        ).firstMatch
        let failed = app.buttons.matching(
            identifier: "rag-tool-event-conversation-visual-tool-events-tool-2-toggle",
        ).firstMatch
        XCTAssertTrue(completed.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(failed.waitForExistence(timeout: 5), app.debugDescription)
        FormUITestConditions.reveal(completed, in: app, scroll: history)
        XCTAssertTrue(completed.isHittable)
        XCTAssertGreaterThanOrEqual(completed.frame.height, 44)
        XCTAssertTrue(completed.label.contains("완료"))

        let completedDetails = UITestConditions.element(
            app,
            "rag-tool-event-conversation-visual-tool-events-tool-1-details",
        )
        let failedDetails = UITestConditions.element(
            app,
            "rag-tool-event-conversation-visual-tool-events-tool-2-details",
        )
        XCTAssertFalse(completedDetails.exists || failedDetails.exists)
        completed.tap()
        XCTAssertTrue(completedDetails.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(failedDetails.exists)
        FormUITestConditions.reveal(failed, in: app, scroll: history)
        XCTAssertTrue(failed.isHittable)
        XCTAssertGreaterThanOrEqual(failed.frame.height, 44)
        XCTAssertTrue(failed.label.contains("실패"))
        failed.tap()
        XCTAssertTrue(failedDetails.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(completedDetails.exists)
    }
}
