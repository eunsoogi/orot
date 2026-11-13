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
        let initialWindows = app.windows
        let initialWindowCount = initialWindows.count
        let initialHistoryOwnerWindows = initialWindows.containing(
            .any,
            identifier: "rag-conversation-history",
        )
        let initialHistoryOwnerWindowCount = initialHistoryOwnerWindows.count
        let initialHistoryOwnerWindow = initialHistoryOwnerWindows.firstMatch
        let initialHistoryOwnerWindowExists = initialHistoryOwnerWindowCount == 1
            && initialHistoryOwnerWindow.exists
        let initialHistoryOwnerWindowFrame = initialHistoryOwnerWindowExists
            ? String(describing: initialHistoryOwnerWindow.frame)
            : "unavailable"
        let keyboard = app.keyboards.firstMatch
        let historyExists = UITestConditions.exists(history)
        let historyFrame = historyExists ? String(describing: history.frame) : "unavailable"
        let composerExists = composer.exists
        let composerFrame = composerExists ? String(describing: composer.frame) : "unavailable"
        let inputExists = UITestConditions.exists(input)
        let initialPrepareExists = prepare.exists
        let initialPrepareFrame = initialPrepareExists ? String(describing: prepare.frame) : "unavailable"
        let initialPrepareEnabledValue: Bool? = initialPrepareExists ? prepare.isEnabled : nil
        let initialPrepareHittableValue: Bool? = initialPrepareExists ? prepare.isHittable : nil
        let initialPrepareEnabled = initialPrepareEnabledValue.map { String($0) } ?? "unavailable"
        let initialPrepareHittable = initialPrepareHittableValue.map { String($0) } ?? "unavailable"
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
        window count=\(initialWindowCount) history-owner-window count=\(initialHistoryOwnerWindowCount) exists=\(initialHistoryOwnerWindowExists) frame=\(initialHistoryOwnerWindowFrame)
        prepare exists=\(initialPrepareExists) enabled=\(initialPrepareEnabled) hittable=\(initialPrepareHittable) frame=\(initialPrepareFrame)
        history exists=\(historyExists) frame=\(historyFrame)
        composer exists=\(composerExists) frame=\(composerFrame)
        input exists=\(inputExists)
        keyboard count=\(keyboardCount) exists=\(keyboardExists) frame=\(keyboardFrame)
        screenshot startedAtUnixSeconds=\(screenshotStartedAt) finishedAtUnixSeconds=\(screenshotFinishedAt)
        """
        // Preserve the launch-time window sample as diagnostic evidence; React Native may attach history after this snapshot.
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
        // The action is registered after React Native mounts, so keep its canonical wait before asserting its properties.
        let readyPrepareExists = UITestConditions.exists(prepare)
        let readinessObservationStartedAt = Date().timeIntervalSince1970
        let readyWindows = app.windows
        let readyWindowCount = readyWindows.count
        let readyHistoryOwnerWindows = readyWindows.containing(
            .any,
            identifier: "rag-conversation-history",
        )
        let readyHistoryOwnerWindowCount = readyHistoryOwnerWindows.count
        let readyHistoryOwnerWindow = readyHistoryOwnerWindows.firstMatch
        let readyHistoryOwnerWindowExists = readyHistoryOwnerWindowCount == 1
            && readyHistoryOwnerWindow.exists
        let readyHistoryOwnerWindowFrame = readyHistoryOwnerWindowExists
            ? String(describing: readyHistoryOwnerWindow.frame)
            : "unavailable"
        let readyPrepareFrame = readyPrepareExists ? String(describing: prepare.frame) : "unavailable"
        let readyPrepareEnabledValue: Bool? = readyPrepareExists ? prepare.isEnabled : nil
        let readyPrepareHittableValue: Bool? = readyPrepareExists ? prepare.isHittable : nil
        let readyPrepareEnabled = readyPrepareEnabledValue.map { String($0) } ?? "unavailable"
        let readyPrepareHittable = readyPrepareHittableValue.map { String($0) } ?? "unavailable"
        let readinessObservationFinishedAt = Date().timeIntervalSince1970
        let readinessObservation = """
        readiness startedAtUnixSeconds=\(readinessObservationStartedAt) finishedAtUnixSeconds=\(readinessObservationFinishedAt)
        history exists=\(historyExists) input exists=\(inputExists)
        window count=\(readyWindowCount) history-owner-window count=\(readyHistoryOwnerWindowCount) exists=\(readyHistoryOwnerWindowExists) frame=\(readyHistoryOwnerWindowFrame)
        prepare exists=\(readyPrepareExists) enabled=\(readyPrepareEnabled) hittable=\(readyPrepareHittable) frame=\(readyPrepareFrame)
        """
        XCTContext.runActivity(named: "Visit preparation ready native geometry") { activity in
            let details = XCTAttachment(string: readinessObservation)
            details.name = "visit-preparation-ready-geometry"
            details.lifetime = .keepAlways
            activity.add(details)
        }
        XCTAssertEqual(readyHistoryOwnerWindowCount, 1, readinessObservation)
        XCTAssertTrue(readyPrepareExists && readyPrepareEnabledValue == true, readinessObservation)
        RecordingFixtureUITestConditions.capture(app, "visit-preparation-action-before-scroll", testCase: self)
        // Accessibility text can expand the conversation header beyond the initial viewport.
        scrollToAndMeasure(prepare, in: history)
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

    /// Records target and viewport geometry around each gesture without weakening the hit-target assertion.
    @MainActor
    private func scrollToAndMeasure(_ element: XCUIElement, in container: XCUIElement) {
        for step in 1 ... 8 {
            let existsBefore = element.exists
            let frameBefore: CGRect? = existsBefore ? element.frame : nil
            let containerFrameBefore = container.frame
            let hittableBefore = existsBefore ? element.isHittable : false
            let orientationBefore = XCUIDevice.shared.orientation.rawValue
            if existsBefore && hittableBefore { return }

            let swipeDown = frameBefore.map { $0.midY < containerFrameBefore.midY } ?? false
            let direction = swipeDown ? "down" : "up"
            if swipeDown {
                container.swipeDown()
            } else {
                container.swipeUp()
            }

            let existsAfter = element.exists
            let frameAfter: CGRect? = existsAfter ? element.frame : nil
            let containerFrameAfter = container.frame
            let hittableAfter = existsAfter ? element.isHittable : false
            let orientationAfter = XCUIDevice.shared.orientation.rawValue
            let deltaY = if let frameBefore, let frameAfter {
                String(format: "%.1f", frameAfter.midY - frameBefore.midY)
            } else {
                "unavailable"
            }
            let targetFrameBefore = frameBefore.map { String(describing: $0) } ?? "unavailable"
            let targetFrameAfter = frameAfter.map { String(describing: $0) } ?? "unavailable"
            let observation = """
            step=\(step) direction=\(direction) orientationBefore=\(orientationBefore) orientationAfter=\(orientationAfter)
            before: target exists=\(existsBefore) hittable=\(hittableBefore) frame=\(targetFrameBefore)
            before: container frame=\(containerFrameBefore)
            after: target exists=\(existsAfter) hittable=\(hittableAfter) frame=\(targetFrameAfter) deltaY=\(deltaY)
            after: container frame=\(containerFrameAfter)
            """
            let attachment = XCTAttachment(string: observation)
            attachment.name = "visit-preparation-reveal-step-\(step)"
            attachment.lifetime = .keepAlways
            XCTContext.runActivity(named: "Measure visit preparation reveal gesture \(step)") { activity in
                activity.add(attachment)
            }
        }
        XCTAssertTrue(element.exists && element.isHittable, element.debugDescription)
    }
}
