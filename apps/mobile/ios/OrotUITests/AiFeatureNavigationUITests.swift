import XCTest

/// Uses App's default dependencies for the non-visit routes. The host clears test Keychain state, so failures must remain recoverable without provider inference.
final class AiFeatureNavigationUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testRootFeatureRoutesKeepTheirClearanceAndRecoverWhenNoProviderIsSelected() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "ai-feature-visit-questions", "-OROT_STORAGE_DIAGNOSTICS", "enabled", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        XCTAssertTrue(UITestConditions.exists(node(app, "welcome-title")))
        try NavigationUITestConditions.contentAboveBar(app, scrollID: "navigation-route-scroll", contentID: "home-empty-recordings", navigationID: "navigation-tab-home")
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        try NavigationUITestConditions.contentAboveBar(app, scrollID: "navigation-route-scroll", contentID: "records-open-health-library", navigationID: "navigation-tab-records")
        let recording = node(app, "records-new-recording")
        FormUITestConditions.reveal(recording, in: app, scrollID: "navigation-route-scroll", towardTop: true)
        recording.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "recording-controls-scroll")))
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
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
        XCTAssertEqual(try NavigationUITestConditions.navigationAction(app, "navigation-tab-schedule").control.label, "일정 탭")
        let hypotheses = node(app, "ai-feature-disease-hypotheses")
        FormUITestConditions.reveal(hypotheses, in: app, scrollID: "ai-features-screen", towardTop: true)
        hypotheses.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "disease-hypotheses-screen")))
        node(app, "disease-hypotheses-generate").tap()
        message(app, "가능성을 정리하지 못했어요. 잠시 후 다시 시도해 주세요.")
        XCTAssertFalse(node(app, "inference-disclosure-sheet").exists)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["ai-features-screen"])
        let conversation = node(app, "ai-feature-rag-conversation")
        FormUITestConditions.reveal(conversation, in: app, scrollID: "ai-features-screen")
        conversation.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "rag-conversation-screen")))
        // The material host shares the identifier; only the native UIButton dispatches Send.
        let send = app.buttons.matching(identifier: "rag-conversation-send").firstMatch
        XCTAssertTrue(UITestConditions.exists(send))
        message(app, "필요하면 동의를 받고 공개 웹자료와 의학 문헌도 찾아요.")
        let input = node(app, "rag-conversation-input")
        FormUITestConditions.replace(input, with: "orot-no-provider-check", in: app, scrollID: "rag-conversation-screen")
        input.typeText("\n")
        FormUITestConditions.reveal(send, in: app, scrollID: "rag-conversation-screen")
        XCTAssertTrue(send.isEnabled)
        XCTAssertTrue(send.isHittable)
        send.tap()
        message(app, "답변을 만들지 못했어요. 잠시 후 다시 시도해 주세요.")
        XCTAssertFalse(node(app, "inference-disclosure-sheet").exists)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        // Conversation sessions persist independently of route exit, including a failed provider request.
        XCTAssertFalse(app.alerts["저장하지 않은 내용이 있어요"].exists)
        NavigationUITestConditions.route(app, markers: ["ai-features-screen"])
        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        try NavigationUITestConditions.contentAboveBar(app, scrollID: "navigation-route-scroll", contentID: "settings-app-info", navigationID: "navigation-tab-settings")
        let provider = node(app, "settings-open-provider")
        FormUITestConditions.reveal(provider, in: app, scrollID: "navigation-route-scroll", towardTop: true)
        provider.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "settings-provider-screen")))
        _ = try NavigationUITestConditions.navigationAction(app, "navigation-back")
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["settings-title"])
        try NavigationUITestConditions.openTab(app, "schedule", markers: ["calendar-title"])
        XCTAssertTrue(node(app, "schedule-open-appointments").exists)
        UITestConditions.value(node(app, "calendar-title"), equals: "일정")
        XCTAssertFalse(node(app, "calendar-connect").exists)
        RecordingFixtureUITestConditions.capture(app, "default-ai-route-recovery-and-calendar-linking", testCase: self)
    }

    /// Inspect retained production routes in both appearances without starting a provider request.
    @MainActor
    func testAiScreensAndSeparateHistoriesAcrossAppearanceChanges() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "ai-feature-visit-questions", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + AppearanceUITestConditions.observationArguments
        app.launch()
        var original: AppearanceUITestConditions.Snapshot?
        defer {
            if let original {
                do { try AppearanceUITestConditions.restore(original, returningTo: app, testCase: self) }
                catch { XCTFail("Could not restore owned Simulator appearance: \(error)") }
            }
            UITestConditions.terminateStandaloneApp(app)
        }
        XCTAssertTrue(UITestConditions.exists(node(app, "welcome-title")))
        for dark in [false, true] {
            _ = try AppearanceUITestConditions.select(dark, returningTo: app, testCase: self, captureOriginal: {
                if original == nil {
                    original = $0
                }
            })
            let suffix = dark ? "dark" : "light"
            try NavigationUITestConditions.openTab(app, "ai", markers: ["ai-features-screen"])
            node(app, "ai-feature-disease-hypotheses").tap()
            XCTAssertTrue(UITestConditions.exists(node(app, "disease-hypotheses-screen")))
            try captureAppearance(app, "symptom-preparation-\(suffix)")
            node(app, "symptom-summary-history-open").tap()
            XCTAssertTrue(UITestConditions.exists(node(app, "summary-history-screen")))
            try captureAppearance(app, "summary-history-empty-\(suffix)")
            try NavigationUITestConditions.tapNavigation(app, "navigation-back")
            XCTAssertTrue(UITestConditions.exists(node(app, "disease-hypotheses-screen")))
            try NavigationUITestConditions.tapNavigation(app, "navigation-back")
            NavigationUITestConditions.route(app, markers: ["ai-features-screen"])
            node(app, "ai-feature-rag-conversation").tap()
            XCTAssertTrue(UITestConditions.exists(node(app, "rag-conversation-screen")))
            try captureAppearance(app, "conversation-empty-\(suffix)")
            node(app, "rag-conversation-sessions-toggle").tap()
            XCTAssertTrue(UITestConditions.exists(node(app, "conversation-history-screen")))
            try captureAppearance(app, "conversation-history-\(suffix)")
            try NavigationUITestConditions.tapNavigation(app, "navigation-back")
            XCTAssertTrue(UITestConditions.exists(node(app, "rag-conversation-screen")))
            try NavigationUITestConditions.tapNavigation(app, "navigation-back")
            NavigationUITestConditions.route(app, markers: ["ai-features-screen"])
            node(app, "ai-feature-visit-questions").tap()
            XCTAssertTrue(UITestConditions.exists(node(app, "next-visit-title")))
            try captureAppearance(app, "visit-questions-ready-\(suffix)")
            try NavigationUITestConditions.tapNavigation(app, "navigation-back")
            NavigationUITestConditions.route(app, markers: ["ai-features-screen"])
            try NavigationUITestConditions.openTab(app, "schedule", markers: ["calendar-title"])
            let classification = node(app, "open-medical-appointments")
            UITestConditions.scrollTo(classification, in: app)
            classification.tap()
            XCTAssertTrue(UITestConditions.exists(node(app, "medical-appointment-select-provider")))
            try captureAppearance(app, "calendar-classification-\(suffix)")
            node(app, "medical-appointment-select-provider").tap()
            XCTAssertTrue(UITestConditions.exists(node(app, "settings-provider-screen")))
            try captureAppearance(app, "model-selection-\(suffix)")
            try NavigationUITestConditions.tapNavigation(app, "navigation-back")
            XCTAssertTrue(UITestConditions.exists(node(app, "medical-appointment-select-provider")))
            try NavigationUITestConditions.tapNavigation(app, "navigation-back")
            NavigationUITestConditions.route(app, markers: ["calendar-title"])
        }
        XCTAssertFalse(node(app, "inference-disclosure-sheet").exists)
    }

    /// The production source renderer reads declared event types and recovery states without patient data or inference.
    @MainActor
    func testEvidenceKindsAndRecoveryAcrossAppearances() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "evidence-visual", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + AppearanceUITestConditions.observationArguments
        app.launch()
        var original: AppearanceUITestConditions.Snapshot?
        defer {
            if let original {
                do { try AppearanceUITestConditions.restore(original, returningTo: app, testCase: self) }
                catch { XCTFail("Could not restore owned Simulator appearance: \(error)") }
            }
            UITestConditions.terminateStandaloneApp(app)
        }
        for dark in [false, true] {
            _ = try AppearanceUITestConditions.select(dark, returningTo: app, testCase: self, captureOriginal: {
                if original == nil {
                    original = $0
                }
            })
            let suffix = dark ? "dark" : "light"
            for (mode, value) in [("medication", "1 정"), ("measurement", "70.5 kg"), ("activity", "2400 걸음"), ("sleep", "코어 수면"), ("period", "집계 기간"), ("loading", ""), ("missing", ""), ("changed", ""), ("unavailable", "")] {
                node(app, "evidence-visual-\(mode)").tap()
                XCTAssertTrue(UITestConditions.exists(node(app, "ai-feature-source-detail")))
                if value.isEmpty {
                    XCTAssertTrue(UITestConditions.exists(node(app, "ai-feature-source-\(mode)")))
                } else {
                    XCTAssertTrue(app.staticTexts[value].waitForAppearance())
                    if mode == "medication" {
                        XCTAssertTrue(app.staticTexts["합성 예시약"].firstMatch.waitForAppearance())
                    }
                    XCTAssertFalse(app.staticTexts["앱 저장 시각"].exists)
                    XCTAssertFalse(app.staticTexts["기록 시각"].exists)
                }
                try captureAppearance(app, "evidence-\(mode)-\(suffix)")
                if mode == "period" {
                    // Sections are horizontal tabs. Select the actual tab before checking its rendered facts.
                    let tabs = try XCTUnwrap(node(app, "ai-feature-source-detail").scrollViews.allElementsBoundByIndex.first { $0.frame.height > 0 && $0.frame.height < 100 })
                    let weight = app.otherElements["체중 · 측정 출처 2 3"].firstMatch
                    for _ in 0 ..< 4 {
                        if weight.exists, tabs.frame.contains(weight.frame), weight.isHittable {
                            break
                        }
                        tabs.swipeLeft()
                    }
                    XCTAssertTrue(tabs.frame.contains(weight.frame))
                    XCTAssertTrue(weight.isHittable)
                    weight.tap()
                    XCTAssertTrue(app.staticTexts["70.5 kg"].waitForAppearance())
                    try captureAppearance(app, "evidence-period-measurements-\(suffix)")
                }
                if mode == "unavailable" {
                    node(app, "ai-feature-source-retry").tap()
                    XCTAssertTrue(app.staticTexts["70.5 kg"].waitForAppearance())
                    try captureAppearance(app, "evidence-retry-recovered-\(suffix)")
                }
                try NavigationUITestConditions.tapNavigation(app, "navigation-back")
                XCTAssertTrue(UITestConditions.exists(node(app, "evidence-visual-picker")))
            }
        }
    }

    @MainActor
    private func captureAppearance(_ app: XCUIApplication, _ name: String) throws {
        // A mounted React scene may still have its detached zero-inset frame during the native push.
        // Capture only after the actual toolbar and the conversation's safe-area frame are installed.
        _ = try NavigationUITestConditions.navigationAction(app, "navigation-back")
        if name.hasPrefix("conversation-empty-") {
            let scene = node(app, "rag-conversation-screen")
            let attached = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                scene.exists && scene.frame.minY > app.frame.minY
            }, object: nil)
            XCTAssertEqual(UITestConditions.wait(for: [attached]), .completed)
        }
        RecordingFixtureUITestConditions.capture(app, name, testCase: self)
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
