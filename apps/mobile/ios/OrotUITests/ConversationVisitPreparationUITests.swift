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
        let observationStartedAt = Date().timeIntervalSince1970
        let windows = app.windows
        let windowCount = windows.count
        let historyOwnerWindows = windows.containing(.any, identifier: "rag-conversation-history")
        let historyOwnerWindowCount = historyOwnerWindows.count
        let historyOwnerWindow = historyOwnerWindows.firstMatch
        let historyOwnerWindowExists = historyOwnerWindowCount == 1 && historyOwnerWindow.exists
        let historyOwnerWindowFrame = historyOwnerWindowExists
            ? String(describing: historyOwnerWindow.frame)
            : "unavailable"
        let keyboard = app.keyboards.firstMatch
        let historyExists = UITestConditions.exists(history)
        let historyFrame = historyExists ? String(describing: history.frame) : "unavailable"
        let composerExists = composer.exists
        let composerFrame = composerExists ? String(describing: composer.frame) : "unavailable"
        let inputExists = UITestConditions.exists(input)
        let prepareExists = prepare.exists
        let prepareFrame = prepareExists ? String(describing: prepare.frame) : "unavailable"
        let prepareEnabledValue: Bool? = prepareExists ? prepare.isEnabled : nil
        let prepareHittableValue: Bool? = prepareExists ? prepare.isHittable : nil
        let prepareEnabled = prepareEnabledValue.map { String($0) } ?? "unavailable"
        let prepareHittable = prepareHittableValue.map { String($0) } ?? "unavailable"
        let keyboardCount = app.keyboards.count
        let keyboardExists = keyboard.exists
        let keyboardFrame = keyboardExists ? String(describing: keyboard.frame) : "unavailable"
        let observationFinishedAt = Date().timeIntervalSince1970
        let screenshotStartedAt = Date().timeIntervalSince1970
        let initialScreenshot = XCTAttachment(screenshot: app.screenshot())
        let screenshotFinishedAt = Date().timeIntervalSince1970
        let observation = """
        observation startedAtUnixSeconds=\(observationStartedAt) finishedAtUnixSeconds=\(observationFinishedAt)
        orientation=\(XCUIDevice.shared.orientation.rawValue)
        window count=\(windowCount) history-owner-window count=\(historyOwnerWindowCount) exists=\(historyOwnerWindowExists) frame=\(historyOwnerWindowFrame)
        prepare exists=\(prepareExists) enabled=\(prepareEnabled) hittable=\(prepareHittable) frame=\(prepareFrame)
        history exists=\(historyExists) frame=\(historyFrame)
        composer exists=\(composerExists) frame=\(composerFrame)
        input exists=\(inputExists)
        keyboard count=\(keyboardCount) exists=\(keyboardExists) frame=\(keyboardFrame)
        screenshot startedAtUnixSeconds=\(screenshotStartedAt) finishedAtUnixSeconds=\(screenshotFinishedAt)
        """
        // Bound AX reads to one timestamped sample so launch-time changes remain visible in the evidence.
        XCTContext.runActivity(named: "Visit preparation initial native geometry") { activity in
            let details = XCTAttachment(string: observation)
            details.name = "visit-preparation-action-geometry"
            details.lifetime = .keepAlways
            activity.add(details)
            initialScreenshot.name = "visit-preparation-action-screen"
            initialScreenshot.lifetime = .keepAlways
            activity.add(initialScreenshot)
        }
        XCTAssertTrue(historyExists && inputExists, observation)
        XCTAssertEqual(historyOwnerWindowCount, 1, observation)
        XCTAssertTrue(prepareExists && prepareEnabledValue == true, observation)
        RecordingFixtureUITestConditions.capture(app, "visit-preparation-action-before-scroll", testCase: self)
        // Accessibility text can expand the conversation header beyond the initial viewport.
        UITestConditions.scrollTo(prepare, in: history)
        let postScrollObservationStartedAt = Date().timeIntervalSince1970
        let prepareExistsAfterScroll = prepare.exists
        let prepareHittableAfterScroll: Bool? = prepareExistsAfterScroll ? prepare.isHittable : nil
        let prepareFrameAfterScroll: CGRect? = prepareExistsAfterScroll ? prepare.frame : nil
        let postScrollObservationFinishedAt = Date().timeIntervalSince1970
        let postScrollHittableDescription = prepareHittableAfterScroll.map { String($0) } ?? "unavailable"
        let postScrollFrameDescription = prepareFrameAfterScroll.map { String(describing: $0) } ?? "unavailable"
        let postScrollObservation = """
        observation startedAtUnixSeconds=\(postScrollObservationStartedAt) finishedAtUnixSeconds=\(postScrollObservationFinishedAt)
        prepare exists=\(prepareExistsAfterScroll) hittable=\(postScrollHittableDescription) frame=\(postScrollFrameDescription)
        """
        XCTAssertTrue(prepareExistsAfterScroll && prepareHittableAfterScroll == true, postScrollObservation)
        if let prepareFrameAfterScroll {
            XCTAssertGreaterThanOrEqual(prepareFrameAfterScroll.height, 44, postScrollObservation)
        } else {
            XCTFail(postScrollObservation)
        }
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
