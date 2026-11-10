import XCTest

/// Synthetic events exercise the production conversation screen and its test-only evidence route.
@MainActor
final class ConversationToolEventsUITests: OrotFailFastTestCase {
    /// Checks independent tool disclosures, their native source route, and large-text behavior in both appearances.
    func testSyntheticToolCallsExpandIndependentlyWithNativeTargets() throws {
        guard #available(iOS 27.0, *) else {
            XCTFail("The tool-event VoiceOver observation requires the public iOS 27 service")
            return
        }
        let voiceOver = VoiceOverTestSession()
        voiceOver.registerRestoration(in: self)
        try voiceOver.prepareForStandardInteraction()

        let app = XCUIApplication()
        // This source-navigation journey alone needs the synthetic retained session identity.
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "conversation-visual",
            "-OROT_TEST_CONVERSATION_TOOL_SOURCE", "YES",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR",
        ] + AppearanceUITestConditions.observationArguments
        var originalAppearance: AppearanceUITestConditions.Snapshot?
        app.launch()
        defer {
            if let originalAppearance {
                do {
                    try AppearanceUITestConditions.restore(
                        originalAppearance,
                        returningTo: app,
                        testCase: self,
                    )
                } catch {
                    XCTFail("Could not restore Simulator appearance: \(error)")
                }
            }
            UITestConditions.terminateStandaloneApp(app)
        }
        _ = try AppearanceUITestConditions.select(
            false,
            returningTo: app,
            testCase: self,
            captureOriginal: { originalAppearance = $0 },
        )

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

        let runId = "conversation-visual-tool-events"
        let running = toolToggle(app, run: runId, call: "tool-running")
        let completed = toolToggle(app, run: runId, call: "tool-1")
        let failed = toolToggle(app, run: runId, call: "tool-2")
        let cancelled = toolToggle(app, run: runId, call: "tool-cancelled")
        let interrupted = toolToggle(app, run: "conversation-visual-tool-retry", call: "tool-1")
        let controls: [(XCUIElement, String, String, String)] = [
            (running, runId, "tool-running", "진행 중"),
            (completed, runId, "tool-1", "완료"),
            (failed, runId, "tool-2", "실패"),
            (cancelled, runId, "tool-cancelled", "취소됨"),
            (interrupted, "conversation-visual-tool-retry", "tool-1", "중단됨"),
        ]
        for (control, run, call, status) in controls {
            XCTAssertTrue(UITestConditions.exists(control), app.debugDescription)
            FormUITestConditions.reveal(control, in: app, scroll: history)
            XCTAssertTrue(control.isHittable, control.debugDescription)
            XCTAssertGreaterThanOrEqual(control.frame.height, 44, control.debugDescription)
            XCTAssertTrue(control.label.contains(status), control.debugDescription)
            XCTAssertFalse(toolDetails(app, run: run, call: call).exists)
        }

        let completedDetails = toolDetails(app, run: runId, call: "tool-1")
        let failedDetails = toolDetails(app, run: runId, call: "tool-2")
        XCTAssertFalse(completedDetails.exists || failedDetails.exists)

        FormUITestConditions.reveal(completed, in: app, scroll: history)
        XCTAssertTrue(completed.isHittable)
        completed.tap()
        XCTAssertTrue(UITestConditions.exists(completedDetails), app.debugDescription)
        XCTAssertFalse(failedDetails.exists)
        XCTAssertEqual(
            Set(completedDetails.staticTexts.allElementsBoundByIndex.map(\.label)),
            Set(["입력 요약", "개인 기록", "결과 요약", "참고 자료 1개", "출처"]),
        )
        let toolSource = completedDetails.buttons.matching(
            NSPredicate(format: "label == %@", "원문 출처 확인 · 개인 기록"),
        ).firstMatch
        XCTAssertTrue(UITestConditions.exists(toolSource), completedDetails.debugDescription)
        FormUITestConditions.reveal(toolSource, in: app, scroll: history)
        XCTAssertTrue(toolSource.isHittable, toolSource.debugDescription)
        XCTAssertGreaterThanOrEqual(toolSource.frame.height, 44, toolSource.debugDescription)

        FormUITestConditions.reveal(failed, in: app, scroll: history)
        XCTAssertTrue(failed.isHittable)
        failed.tap()
        XCTAssertTrue(UITestConditions.exists(failedDetails), app.debugDescription)
        XCTAssertTrue(completedDetails.exists)
        XCTAssertEqual(
            Set(failedDetails.staticTexts.allElementsBoundByIndex.map(\.label)),
            Set(["입력 요약", "공개 의학 문헌", "결과 요약", "결과 요약을 사용할 수 없어요.", "출처", "연결된 출처가 없어요."]),
        )

        FormUITestConditions.reveal(completed, in: app, scroll: history)
        completed.tap()
        XCTAssertFalse(completedDetails.exists)
        XCTAssertTrue(failedDetails.exists)
        FormUITestConditions.reveal(failed, in: app, scroll: history)
        failed.tap()
        XCTAssertFalse(failedDetails.exists)

        // The hint must distinguish the two real native disclosure states, not just repeat the status.
        FormUITestConditions.reveal(completed, in: app, scroll: history)
        XCTAssertTrue(completed.label.contains("local_records · 완료"), completed.debugDescription)
        try voiceOver.assertSpeech(
            from: completed,
            expected: "도구 호출 세부 정보 표시",
            forbiddenTerms: [],
            phase: "conversation-tool-event-collapsed",
            testCase: self,
        )
        completed.doubleTap()
        XCTAssertTrue(UITestConditions.exists(completedDetails), app.debugDescription)
        try voiceOver.assertSpeech(
            from: completed,
            expected: "도구 호출 세부 정보 숨기기",
            forbiddenTerms: [],
            phase: "conversation-tool-event-expanded",
            testCase: self,
        )
        try voiceOver.prepareForStandardInteraction()
        FormUITestConditions.reveal(toolSource, in: app, scroll: history)
        try voiceOver.assertSpeech(
            from: toolSource,
            expected: "원문 출처 확인",
            forbiddenTerms: [],
            phase: "conversation-tool-source",
            testCase: self,
        )
        try voiceOver.prepareForStandardInteraction()
        FormUITestConditions.reveal(completed, in: app, scroll: history)
        completed.tap()
        XCTAssertFalse(completedDetails.exists)

        // The conversation keeps its real large-text target and source route after a system appearance change.
        _ = try AppearanceUITestConditions.select(
            true,
            returningTo: app,
            testCase: self,
        )
        FormUITestConditions.reveal(completed, in: app, scroll: history)
        XCTAssertTrue(completed.isHittable)
        XCTAssertGreaterThanOrEqual(completed.frame.height, 44, completed.debugDescription)
        completed.tap()
        let darkCompletedDetails = toolDetails(app, run: runId, call: "tool-1")
        XCTAssertTrue(UITestConditions.exists(darkCompletedDetails), app.debugDescription)
        let darkToolSource = darkCompletedDetails.buttons.matching(
            NSPredicate(format: "label == %@", "원문 출처 확인 · 개인 기록"),
        ).firstMatch
        FormUITestConditions.reveal(darkToolSource, in: app, scroll: history)
        XCTAssertTrue(darkToolSource.isHittable, darkToolSource.debugDescription)
        XCTAssertGreaterThanOrEqual(darkToolSource.frame.height, 44, darkToolSource.debugDescription)
        darkToolSource.tap()

        let toolSourceDetail = UITestConditions.element(app, "ai-feature-source-detail")
        XCTAssertTrue(UITestConditions.exists(toolSourceDetail), app.debugDescription)
        XCTAssertTrue(toolSourceDetail.staticTexts["근거 살펴보기"].exists, toolSourceDetail.debugDescription)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "rag-conversation-screen")), app.debugDescription)

        // Reopen the native keyboard so scrolling and composer reachability are checked together.
        if !app.keyboards.firstMatch.exists {
            input.tap()
            ConversationComposerDockUITestConditions.waitForVisibleKeyboard(in: app)
        }
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        XCTAssertTrue(input.isHittable)
        XCTAssertTrue(send.isHittable)
        FormUITestConditions.reveal(interrupted, in: app, scroll: history)
        XCTAssertTrue(interrupted.isHittable)

        let answer = UITestConditions.element(app, "rag-conversation-answer-body")
        XCTAssertTrue(UITestConditions.exists(answer), app.debugDescription)
        FormUITestConditions.reveal(answer, in: app, scroll: history)
        let originalAnswer = UITestConditions.text(answer)
        let sourceList = app.descendants(matching: .any)
            .matching(identifier: "rag-conversation-sources").firstMatch
        let source = sourceList.buttons.matching(
            NSPredicate(format: "label BEGINSWITH %@", "원문 근거 열기"),
        ).firstMatch
        XCTAssertTrue(UITestConditions.exists(source), app.debugDescription)
        FormUITestConditions.reveal(source, in: app, scroll: history)
        XCTAssertTrue(source.isHittable, source.debugDescription)
        source.tap()

        let sourceDetail = UITestConditions.element(app, "ai-feature-source-detail")
        XCTAssertTrue(UITestConditions.exists(sourceDetail), app.debugDescription)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        let conversationScreen = UITestConditions.element(app, "rag-conversation-screen")
        XCTAssertTrue(UITestConditions.exists(conversationScreen), app.debugDescription)
        let returnedAnswer = UITestConditions.element(app, "rag-conversation-answer-body")
        XCTAssertTrue(UITestConditions.exists(returnedAnswer), app.debugDescription)
        FormUITestConditions.reveal(returnedAnswer, in: app, scroll: history)
        XCTAssertEqual(UITestConditions.text(returnedAnswer), originalAnswer)
    }

    /// Resolve a disclosure by both identities so a retry with a reused call ID stays distinct.
    private func toolToggle(_ app: XCUIApplication, run: String, call: String) -> XCUIElement {
        app.buttons.matching(identifier: "rag-tool-event-\(run)-\(call)-toggle").firstMatch
    }

    private func toolDetails(_ app: XCUIApplication, run: String, call: String) -> XCUIElement {
        UITestConditions.element(app, "rag-tool-event-\(run)-\(call)-details")
    }
}
