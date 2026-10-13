import XCTest

/// Uses App's default dependencies for the non-visit routes. The host clears test Keychain state, so failures must remain recoverable without provider inference.
final class AiFeatureNavigationUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testRootFeatureRoutesKeepTheirClearanceAndRecoverWhenNoProviderIsSelected() throws {
        let started = ContinuousClock.now
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "ai-feature-visit-questions", "-OROT_STORAGE_DIAGNOSTICS", "enabled", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(UITestConditions.exists(node(app, "welcome-title")))
        try NavigationUITestConditions.contentAboveBar(app, scrollID: "navigation-route-scroll", contentID: "home-empty-recordings", navigationID: "navigation-tab-home")
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        try NavigationUITestConditions.contentAboveBar(app, scrollID: "navigation-route-scroll", contentID: "records-open-blood-pressure", navigationID: "navigation-tab-records")
        let recording = node(app, "records-new-recording")
        FormUITestConditions.reveal(recording, in: app, scrollID: "navigation-route-scroll", towardTop: true)
        recording.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "recording-controls-scroll")))
        try NavigationUITestConditions.tapNative(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["records-title"])
        try NavigationUITestConditions.openTab(app, "ai", markers: ["ai-features-screen"])
        try NavigationUITestConditions.contentAboveBar(app, scrollID: "ai-features-screen", contentID: "ai-feature-rag-conversation", navigationID: "navigation-tab-ai")
        // Native accessibility groups each Pressable's title and description into its button label.
        // Retain every original title assertion against the corresponding actual card rather than requiring an unexposed child StaticText.
        for (identifier, title) in [("visit-questions", "다음 진료 질문"), ("disease-hypotheses", "증상 정리"), ("rag-conversation", "기록과 대화")] {
            let card = app.buttons.matching(identifier: "ai-feature-\(identifier)").firstMatch
            XCTAssertTrue(card.exists, app.debugDescription)
            XCTAssertTrue(card.label.hasPrefix(title), card.debugDescription)
        }
        XCTAssertFalse(node(app, "ai-feature-external-evidence").exists)
        XCTAssertEqual(try NavigationUITestConditions.nativeAction(app, "navigation-tab-schedule").control.label, "일정 탭")
        let hypotheses = node(app, "ai-feature-disease-hypotheses")
        FormUITestConditions.reveal(hypotheses, in: app, scrollID: "ai-features-screen", towardTop: true)
        hypotheses.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "disease-hypotheses-screen")))
        node(app, "disease-hypotheses-generate").tap()
        message(app, "가능성을 정리하지 못했어요. 잠시 후 다시 시도해 주세요.")
        XCTAssertFalse(node(app, "inference-disclosure-sheet").exists)
        try NavigationUITestConditions.tapNative(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["ai-features-screen"])
        let conversation = node(app, "ai-feature-rag-conversation")
        FormUITestConditions.reveal(conversation, in: app, scrollID: "ai-features-screen")
        conversation.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "rag-conversation-screen")))
        XCTAssertTrue(UITestConditions.exists(node(app, "rag-conversation-send")))
        message(app, "필요하면 동의를 받고 공개 의학 문헌도 찾아요.")
        let input = node(app, "rag-conversation-input")
        FormUITestConditions.replace(input, with: "orot-no-provider-check", in: app, scrollID: "rag-conversation-screen")
        input.typeText("\n")
        let send = node(app, "rag-conversation-send")
        FormUITestConditions.reveal(send, in: app, scrollID: "rag-conversation-screen")
        send.tap()
        message(app, "답변을 만들지 못했어요. 잠시 후 다시 시도해 주세요.")
        XCTAssertFalse(node(app, "inference-disclosure-sheet").exists)
        try NavigationUITestConditions.tapNative(app, "navigation-back")
        // The submitted synthetic message is local draft state, so the original journey explicitly confirms its leave guard.
        let leave = app.alerts["저장하지 않은 내용이 있어요"]
        XCTAssertTrue(UITestConditions.exists(leave), app.debugDescription)
        leave.buttons["내용 버리고 나가기"].tap()
        NavigationUITestConditions.route(app, markers: ["ai-features-screen"])
        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        try NavigationUITestConditions.contentAboveBar(app, scrollID: "navigation-route-scroll", contentID: "settings-app-info", navigationID: "navigation-tab-settings")
        let provider = node(app, "settings-open-provider")
        FormUITestConditions.reveal(provider, in: app, scrollID: "navigation-route-scroll", towardTop: true)
        provider.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "settings-provider-screen")))
        _ = try NavigationUITestConditions.nativeAction(app, "navigation-back")
        try NavigationUITestConditions.tapNative(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["settings-title"])
        try NavigationUITestConditions.openTab(app, "schedule", markers: ["calendar-title"])
        XCTAssertTrue(node(app, "schedule-open-appointments").exists)
        UITestConditions.value(node(app, "calendar-title"), equals: "일정")
        XCTAssertEqual(node(app, "calendar-connect").label, "캘린더 일정 불러오기")
        RecordingFixtureUITestConditions.capture(app, "default-ai-route-recovery-and-calendar-linking", testCase: self)
        XCTAssertLessThan(started.duration(to: .now), .seconds(180), "Retain the original integrated navigation budget")
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }

    @MainActor
    private func message(_ app: XCUIApplication, _ text: String) {
        let message = app.staticTexts.matching(NSPredicate(format: "label == %@", text)).firstMatch
        XCTAssertTrue(UITestConditions.exists(message), app.debugDescription)
        XCTAssertTrue(message.isHittable, message.debugDescription)
    }
}
