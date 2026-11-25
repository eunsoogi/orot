import XCTest

/// Verifies saved-result routes and Duo history layout, including a native landscape transition.
final class ConversationHistoryDuoUITests: OrotFailFastTestCase {
    /// Checks actual titles, button hit targets, and saved-route navigation without starting a provider or rotating.
    @MainActor
    func testSavedOutputActionsOpenAndReturnFromHistory() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "ai-feature-visit-questions", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }

        XCTAssertTrue(UITestConditions.exists(node(app, "rag-conversation-screen")))
        NavigationPageActionUITestConditions.tap(app, id: "rag-conversation-sessions-toggle", label: "대화 목록")
        NavigationUITestConditions.route(app, markers: ["conversation-history-screen"])

        let page = node(app, "conversation-history-page")
        let title = node(app, "conversation-history-title")
        let count = node(app, "conversation-history-count")
        let savedOutputsTitle = node(app, "conversation-history-saved-outputs-title")
        XCTAssertTrue(UITestConditions.exists(page))
        XCTAssertTrue(UITestConditions.exists(title) && title.isHittable)
        XCTAssertTrue(UITestConditions.exists(count))
        XCTAssertTrue(UITestConditions.exists(savedOutputsTitle))
        XCTAssertEqual(title.label, "대화 기록")
        XCTAssertEqual(savedOutputsTitle.label, "저장된 AI 결과")
        XCTAssertLessThan(title.frame.minY, count.frame.minY)
        XCTAssertLessThan(count.frame.minY, savedOutputsTitle.frame.minY)

        let savedAnalysis = node(app, "conversation-saved-analysis")
        let savedVisitQuestions = node(app, "conversation-saved-visit-questions")
        XCTAssertTrue(savedAnalysis.exists && savedAnalysis.isHittable && savedAnalysis.isEnabled, app.debugDescription)
        XCTAssertTrue(savedVisitQuestions.exists && savedVisitQuestions.isHittable && savedVisitQuestions.isEnabled, app.debugDescription)
        XCTAssertLessThan(savedAnalysis.frame.minY, savedVisitQuestions.frame.minY)
        XCTAssertGreaterThanOrEqual(savedAnalysis.frame.width, 44)
        XCTAssertGreaterThanOrEqual(savedAnalysis.frame.height, 44)
        XCTAssertTrue(savedAnalysis.label.contains("저장된 요약과 가능성"), savedAnalysis.debugDescription)
        XCTAssertTrue(savedAnalysis.label.contains("다시 살펴봐요"), savedAnalysis.debugDescription)
        XCTAssertTrue(page.frame.contains(savedAnalysis.frame), app.debugDescription)
        savedAnalysis.tap()
        NavigationUITestConditions.route(app, markers: ["disease-hypotheses-screen"])
        XCTAssertFalse(node(app, "disease-hypotheses-generate").exists)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["conversation-history-screen"])

        XCTAssertGreaterThanOrEqual(savedVisitQuestions.frame.width, 44)
        XCTAssertGreaterThanOrEqual(savedVisitQuestions.frame.height, 44)
        XCTAssertTrue(savedVisitQuestions.label.contains("저장된 진료 질문"), savedVisitQuestions.debugDescription)
        XCTAssertTrue(savedVisitQuestions.label.contains("다시 살펴봐요"), savedVisitQuestions.debugDescription)
        XCTAssertTrue(page.frame.contains(savedVisitQuestions.frame), app.debugDescription)
        savedVisitQuestions.tap()
        NavigationUITestConditions.route(app, markers: ["saved-visit-questions-screen"])
        XCTAssertFalse(node(app, "next-visit-generate").exists)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["conversation-history-screen"])
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["rag-conversation-screen"])
    }

    /// Confirms the history header, saved shortcuts, and list remain ordered and reachable after a native Duo rotation.
    @MainActor
    func testLandscapeHistoryKeepsLargeTextAndVoiceOverOrder() throws {
        guard #available(iOS 27.0, *) else {
            XCTFail("The Duo history speech-order check requires the public iOS 27 VoiceOver service")
            return
        }
        let voiceOver = VoiceOverTestSession()
        voiceOver.registerRestoration(in: self)
        try voiceOver.prepareForStandardInteraction()

        let app = XCUIApplication()
        let originalOrientation = XCUIDevice.shared.orientation
        let session = UUID().uuidString
        defer {
            UITestConditions.terminateStandaloneApp(app)
            XCUIDevice.shared.orientation = originalOrientation
        }
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "conversation-visual",
            "-OROT_TEST_HISTORY_SAVED_OUTPUT_LAYOUT", "YES",
            "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-OROT_TEST_ROTATION_GEOMETRY_SESSION", session,
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR",
        ]
        app.launch()
        XCTAssertTrue(UITestConditions.exists(node(app, "rag-conversation-screen")))
        NavigationPageActionUITestConditions.tap(app, id: "rag-conversation-sessions-toggle", label: "대화 목록")
        NavigationUITestConditions.route(app, markers: ["conversation-history-screen"])

        let receipt = try NavigationRotationUITestConditions.rotateObservedScene(app, session: session, landscape: true)
        XCTAssertEqual((receipt["before"] as? [String: Any])?["sceneOrientation"] as? Int, UIInterfaceOrientation.portrait.rawValue)
        // XCUIDevice landscapeLeft is observed by UIKit as interface landscapeRight.
        XCTAssertEqual((receipt["current"] as? [String: Any])?["sceneOrientation"] as? Int, UIInterfaceOrientation.landscapeRight.rawValue)
        XCTAssertTrue(UITestConditions.exists(node(app, "conversation-history-screen")))

        let title = node(app, "conversation-history-title")
        let count = node(app, "conversation-history-count")
        let savedOutputsTitle = node(app, "conversation-history-saved-outputs-title")
        let savedAnalysis = node(app, "conversation-saved-analysis")
        let savedVisitQuestions = node(app, "conversation-saved-visit-questions")
        let row = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "conversation-history-session-")).firstMatch
        let contentRegion = node(app, "navigation-content-region")
        let regionFrame = contentRegion.frame

        XCTAssertTrue(UITestConditions.exists(title) && title.isHittable)
        XCTAssertEqual(title.label, "대화 기록")
        XCTAssertTrue(UITestConditions.exists(count) && !count.label.isEmpty)
        XCTAssertTrue(UITestConditions.exists(savedOutputsTitle))
        XCTAssertEqual(savedOutputsTitle.label, "저장된 AI 결과")
        XCTAssertTrue(UITestConditions.exists(savedAnalysis) && !savedAnalysis.label.isEmpty)
        XCTAssertTrue(UITestConditions.exists(savedVisitQuestions) && !savedVisitQuestions.label.isEmpty)
        XCTAssertTrue(UITestConditions.exists(row))
        XCTAssertTrue(regionFrame.insetBy(dx: -0.5, dy: -0.5).contains(title.frame))
        XCTAssertTrue(regionFrame.insetBy(dx: -0.5, dy: -0.5).contains(count.frame))

        let service = XCUIDevice.shared.voiceOverService
        try voiceOver.assertSpeech(from: title, expected: "대화 기록", forbiddenTerms: [], phase: "history-title-order", testCase: self)
        let countOutput = try service.moveForward()
        assertVoiceOverSpeechOutput(countOutput, expected: count.label, phase: "history-count-order", testCase: self)
        let savedOutputsOutput = try service.moveForward()
        assertVoiceOverSpeechOutput(savedOutputsOutput, expected: "저장된 AI 결과", phase: "history-saved-group-order", testCase: self)
        let savedAnalysisOutput = try service.moveForward()
        assertVoiceOverSpeechOutput(savedAnalysisOutput, expected: "저장된 요약과 가능성", phase: "history-saved-analysis-order", testCase: self)
        let savedQuestionsOutput = try service.moveForward()
        assertVoiceOverSpeechOutput(savedQuestionsOutput, expected: "저장된 진료 질문", phase: "history-saved-questions-order", testCase: self)
        let todayOutput = try service.moveForward()
        assertVoiceOverSpeechOutput(todayOutput, expected: "오늘", phase: "history-list-section-order", testCase: self)
        let rowOutput = try service.moveForward()
        assertVoiceOverSpeechOutput(rowOutput, expected: "새 대화", phase: "history-list-row-order", testCase: self)
        try voiceOver.prepareForStandardInteraction()

        for action in [savedAnalysis, savedVisitQuestions] {
            XCTAssertTrue(action.label.contains("다시 살펴봐요"))
            _ = FormUITestConditions.reveal(action, in: app, scrollID: "conversation-history-page")
            XCTAssertTrue(action.exists && action.isHittable)
            XCTAssertGreaterThanOrEqual(action.frame.width, 44)
            XCTAssertGreaterThanOrEqual(action.frame.height, 44)
            XCTAssertTrue(regionFrame.insetBy(dx: -0.5, dy: -0.5).contains(action.frame))
        }
        _ = FormUITestConditions.reveal(row, in: app, scrollID: "conversation-history-page")
        XCTAssertTrue(row.exists && row.isHittable)
        XCTAssertGreaterThanOrEqual(row.frame.width, 44)
        XCTAssertGreaterThanOrEqual(row.frame.height, 44)
        try NavigationUITestConditions.contentClearOfNavigation(
            app,
            scrollID: "conversation-history-page",
            contentID: row.identifier,
            testCase: self,
        )
    }

    /// Observe actual compositor pixels, not just AX frames, on the measured split host.
    @MainActor
    func testPreparedVisitKeepsRenderedOutgoingTextInsideItsBubble() throws {
        let app = XCUIApplication()
        let original = XCUIDevice.shared.orientation
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "conversation-visual",
            "-OROT_TEST_CONVERSATION_VISIT_PREPARATION", "YES",
            "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR",
        ]
        app.launch()
        defer {
            UITestConditions.terminateStandaloneApp(app)
            XCUIDevice.shared.orientation = original
        }

        let activity = node(app, "conversation-activity-pane")
        let transcript = node(app, "conversation-transcript-pane")
        let prepare = app.buttons.matching(identifier: "conversation-visit-prepare").firstMatch
        XCTAssertTrue(UITestConditions.exists(transcript))
        XCTAssertTrue(UITestConditions.exists(activity) && activity.frame.width > 0, "An ordinary landscape layout is not a Duo split")
        XCTAssertLessThanOrEqual(activity.frame.maxX, transcript.frame.minX + 1)
        XCTAssertTrue(UITestConditions.exists(prepare) && prepare.isHittable)
        prepare.tap()

        let review = node(app, "inline-visit-review")
        let shell = node(app, "conversation-user-message")
        let text = shell.staticTexts.firstMatch
        XCTAssertTrue(UITestConditions.exists(review))
        XCTAssertTrue(UITestConditions.exists(text))
        let expected = UITestConditions.text(text)
        XCTAssertFalse(expected.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

        // Sample both stages before asserting, so a detached first paint still
        // records what the same text and host did after foregrounding.
        let first = (shell.frame, transcript.frame, RenderedTextUITestConditions.sample(text, in: app))
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(app.wait(for: .runningBackground, timeout: 10))
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        XCTAssertTrue(UITestConditions.exists(text))
        let returned = (shell.frame, transcript.frame, RenderedTextUITestConditions.sample(text, in: app))
        func assertPaint(_ stage: String, _ frames: (CGRect, CGRect, RenderedTextUITestConditions.Sample)) throws {
            let (shellFrame, transcriptFrame, glyph) = frames
            let bounds = shellFrame.insetBy(dx: 1, dy: 1)
            try RenderedTextUITestConditions.verify(glyph, equals: expected, attachmentName: stage, testCase: self)
            XCTAssertTrue(bounds.contains(glyph.frame), "\(stage): glyph frame \(glyph.frame), bubble frame \(bounds)")
            XCTAssertTrue(transcriptFrame.contains(bounds), "\(stage): bubble must remain inside its transcript lane")
        }
        // Keep the post-return image even if the initial OCR or geometry fails.
        let returnAttachment = XCTAttachment(screenshot: returned.2.screenshot)
        returnAttachment.name = "bubble-after-foreground"
        returnAttachment.lifetime = .keepAlways
        add(returnAttachment)
        try assertPaint("bubble-first-native-paint", first)
        try assertPaint("bubble-after-foreground-verified", returned)

        // Test the existing native gesture independently of the initial-paint assertions.
        shell.press(forDuration: 1)
        let copy = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "복사")).firstMatch
        XCTAssertTrue(UITestConditions.exists(copy))
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        UITestConditions.element(app, identifier)
    }
}
