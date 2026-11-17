import XCTest

/// Keeps current continuous-entry acceptance independent of legacy manual-session journeys.
@MainActor
final class ConversationContinuousEntryUITests: OrotFailFastTestCase {
    /// A new independent journey uses automatic continuous identity, not the removed manual-history UI.
    /// The sender/selection are synthetic; storage, process restart, frames and keyboard targets are real.
    func testContinuousEntryRestoresChoiceBoundaryAfterRestart() {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "conversation-retention", "-OROT_TEST_CONTINUOUS_RETENTION", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        guard send(app) else { return }
        app.buttons["retention-probe-release"].tap()
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["Synthetic committed response"]))
        observe(app, "dispatches:1 completions:1 previews:0")
        app.terminate()
        app.launch()
        // Match the semantic answer container, not its equally labelled nested text span.
        let restored = app.staticTexts.matching(NSPredicate(format: "identifier == %@ AND label == %@", "rag-conversation-answer-body", "Synthetic committed response")).firstMatch
        XCTAssertTrue(UITestConditions.exists(restored), "The current entry must restore without manual session selection")
        let divider = UITestConditions.element(app, "conversation-choices-divider")
        let choices = UITestConditions.element(app, "conversation-quick-choices")
        let history = UITestConditions.element(app, "rag-conversation-history")
        XCTAssertTrue(UITestConditions.exists(divider))
        XCTAssertEqual(divider.frame.height, 1, accuracy: 0.5)
        XCTAssertGreaterThan(divider.frame.width, 200)
        XCTAssertLessThanOrEqual(restored.frame.maxY, divider.frame.minY)
        for identifier in ["conversation-open-possibilities", "conversation-open-visit-questions", "conversation-open-health-summary", "daily-report-request"] {
            let action = app.buttons[identifier]
            XCTAssertTrue(UITestConditions.exists(action), identifier)
            FormUITestConditions.reveal(action, in: app, scroll: history)
            XCTAssertTrue(action.isHittable, identifier)
            XCTAssertGreaterThanOrEqual(action.frame.height, 44)
            XCTAssertGreaterThanOrEqual(action.frame.minY, divider.frame.maxY)
        }
        FormUITestConditions.reveal(choices, in: app, scroll: history, requireHittable: false)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "continuous-restored-choice-boundary"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        guard send(app, question: "Synthetic new turn") else { return }
        let input = UITestConditions.element(app, "rag-conversation-input")
        ConversationComposerDockUITestConditions.waitForVisibleKeyboard(in: app)
        // A preview can precede the native keyboard/layout animation's final hit-test frame.
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            input.isHittable && input.frame.maxY <= app.keyboards.firstMatch.frame.minY
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed)
        XCTAssertTrue(input.isHittable)
        XCTAssertLessThanOrEqual(input.frame.maxY, app.keyboards.firstMatch.frame.minY)
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "conversation-choices-divider").count, 1)
        // User text has no testID; RN exposes both its parent and nested span with the same label.
        let newTurn = app.staticTexts.matching(NSPredicate(format: "label == %@", "Synthetic new turn")).allElementsBoundByIndex
        XCTAssertFalse(newTurn.isEmpty)
        for text in newTurn {
            XCTAssertLessThanOrEqual(divider.frame.maxY, text.frame.minY)
        }
        let keyboardCapture = XCTAttachment(screenshot: app.screenshot())
        keyboardCapture.name = "continuous-restored-new-turn-keyboard"
        keyboardCapture.lifetime = .keepAlways
        add(keyboardCapture)
    }

    private func observe(_ app: XCUIApplication, _ expected: String) {
        app.buttons["retention-probe-refresh"].tap()
        let label = app.staticTexts["retention-probe-status"]
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", expected), object: label)
        XCTAssertEqual(UITestConditions.wait(for: [expectation]), .completed, label.debugDescription)
    }

    private func send(_ app: XCUIApplication, question: String = "Synthetic retention question", waitForPartial: Bool = true) -> Bool {
        let input = UITestConditions.element(app, "rag-conversation-input")
        XCTAssertTrue(UITestConditions.exists(input) && input.isHittable)
        input.tap()
        input.typeText(question)
        XCTAssertEqual(input.value as? String, question)
        app.buttons["rag-conversation-send"].tap()
        if waitForPartial {
            let partial = app.staticTexts["Synthetic partial response"]
            let error = UITestConditions.element(app, "rag-conversation-error")
            // A terminal error prevents a preview from appearing for this request.
            let outcome = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in partial.exists || error.exists || app.state == .notRunning }, object: nil)
            XCTAssertEqual(UITestConditions.wait(for: [outcome]), .completed)
            guard app.state != .notRunning else {
                XCTFail("Application terminated before the synthetic preview")
                return false
            }
            guard !error.exists else {
                let status = app.staticTexts["retention-probe-status"]
                XCTFail("Synthetic request failed before preview; \(status.exists ? status.label : "stage unavailable")")
                return false
            }
            XCTAssertTrue(UITestConditions.exists(app.staticTexts["Synthetic partial response"]))
        }
        return true
    }
}
