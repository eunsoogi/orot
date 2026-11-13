import XCTest

/// Verifies the prepared-question card on the native surface with synthetic content only.
final class ConversationVisitPreparationUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testLongPreparedQuestionKeepsAccessibleOrderWithLargeTextAndKeyboard() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "conversation-visual",
            "-OROT_TEST_CONVERSATION_VISIT_PREPARATION", "YES",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR",
        ]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }

        let history = UITestConditions.element(app, "rag-conversation-history")
        let composer = UITestConditions.element(app, "rag-conversation-composer")
        let input = FormUITestConditions.multilineInput(app, identifier: "rag-conversation-input")
        let prepare = app.buttons.matching(identifier: "conversation-visit-prepare").firstMatch
        let window = app.windows.firstMatch
        let keyboard = app.keyboards.firstMatch
        let windowExists = window.exists
        let windowFrame = window.frame
        let historyExists = UITestConditions.exists(history)
        let historyFrame = history.frame
        let composerExists = composer.exists
        let composerFrame = composer.frame
        let inputExists = UITestConditions.exists(input)
        let prepareExists = prepare.exists
        let prepareFrame = prepare.frame
        let prepareEnabled = prepare.isEnabled
        let prepareHittable = prepare.isHittable
        let keyboardCount = app.keyboards.count
        let keyboardFrame = keyboard.frame
        let observation = """
        orientation=\(XCUIDevice.shared.orientation.rawValue)
        window exists=\(windowExists) frame=\(windowFrame)
        prepare exists=\(prepareExists) enabled=\(prepareEnabled) hittable=\(prepareHittable) frame=\(prepareFrame)
        history exists=\(historyExists) frame=\(historyFrame)
        composer exists=\(composerExists) frame=\(composerFrame)
        input exists=\(inputExists)
        keyboard count=\(keyboardCount) frame=\(keyboardFrame)
        """
        // Keep one pre-scroll observation so a missing window is distinguishable from an offscreen action.
        XCTContext.runActivity(named: "Visit preparation initial native geometry") { activity in
            let details = XCTAttachment(string: observation)
            details.name = "visit-preparation-action-geometry"
            details.lifetime = .keepAlways
            activity.add(details)
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = "visit-preparation-action-screen"
            screenshot.lifetime = .keepAlways
            activity.add(screenshot)
        }
        XCTAssertTrue(historyExists && inputExists, observation)
        XCTAssertTrue(prepareExists && prepareEnabled, observation)
        RecordingFixtureUITestConditions.capture(app, "visit-preparation-action-before-scroll", testCase: self)
        // Accessibility text can expand the conversation header beyond the initial viewport.
        UITestConditions.scrollTo(prepare, in: history)
        XCTAssertTrue(prepare.isHittable, app.debugDescription)
        XCTAssertGreaterThanOrEqual(prepare.frame.height, 44, app.debugDescription)
        XCTAssertFalse(UITestConditions.element(app, "inline-visit-review").exists)
        RecordingFixtureUITestConditions.capture(app, "visit-preparation-before-explicit-action", testCase: self)

        prepare.tap()
        let answer = UITestConditions.element(app, "rag-conversation-answer-body")
        let review = UITestConditions.element(app, "inline-visit-review")
        let selection = UITestConditions.element(app, "inline-visit-select-0")
        let question = FormUITestConditions.multilineInput(app, identifier: "next-visit-question-text-0")
        let details = UITestConditions.element(app, "next-visit-question-details-0")
        let priority = UITestConditions.element(app, "next-visit-question-priority-0")
        let save = app.buttons.matching(identifier: "inline-visit-save").firstMatch

        XCTAssertTrue(UITestConditions.exists(answer))
        XCTAssertTrue(UITestConditions.exists(review) && UITestConditions.exists(question))
        XCTAssertTrue(UITestConditions.exists(selection) && UITestConditions.exists(details) && UITestConditions.exists(priority))
        XCTAssertEqual(question.value as? String, "진료 전에 지난 한 달 동안 증상이 처음 시작된 날짜와 강도를 기록한 시점, 복용 중인 약의 변경 시기, 수면과 활동량의 변화가 서로 어떤 순서로 나타났는지 의사에게 어떻게 설명하면 좋을까요?")
        XCTAssertLessThanOrEqual(answer.frame.maxY, review.frame.minY + 1)
        XCTAssertLessThanOrEqual(selection.frame.minY, question.frame.minY + 1)
        XCTAssertLessThan(question.frame.minX, details.frame.minX)
        XCTAssertLessThan(details.frame.minX, priority.frame.minX)
        XCTAssertTrue(question.isHittable)
        RecordingFixtureUITestConditions.capture(app, "visit-preparation-question-at-accessibility-xxxl", testCase: self)

        selection.tap()
        XCTAssertTrue(save.isEnabled)
        let expectedAccessibilityOrder = [
            "inline-visit-select-0",
            "next-visit-question-text-0",
            "next-visit-question-details-0",
            "next-visit-question-priority-0",
            "inline-visit-save",
        ]
        // Filter one native snapshot to the prepared block's interactive sequence instead of dumping the full hierarchy.
        let observedAccessibilityOrder = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier IN %@", expectedAccessibilityOrder))
            .allElementsBoundByIndex
            .map(\.identifier)
        XCTAssertEqual(observedAccessibilityOrder, expectedAccessibilityOrder)
        question.tap()
        ConversationComposerDockUITestConditions.waitForVisibleKeyboard(in: app)
        XCTAssertTrue(question.isHittable)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        XCTAssertTrue(input.exists && input.isHittable)
        XCTAssertLessThanOrEqual(history.frame.maxY, composer.frame.minY + 1)
        XCTAssertLessThanOrEqual(composer.frame.maxY, app.keyboards.firstMatch.frame.minY + 1)
        RecordingFixtureUITestConditions.capture(app, "visit-preparation-question-keyboard-at-accessibility-xxxl", testCase: self)
    }
}
