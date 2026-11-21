import XCTest

/// Uses App's default dependencies for the non-visit routes. The host clears test Keychain state, so failures must remain recoverable without provider inference.
final class AiFeatureNavigationUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testRootFeatureRoutesKeepTheirClearanceAndRecoverWhenNoProviderIsSelected() throws {
        let observationSession = ConversationHitUITestObservation.validatedSession()
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "ai-feature-visit-questions", "-OROT_STORAGE_DIAGNOSTICS", "enabled", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES", "-OROT_TEST_CONVERSATION_HIT_OBSERVATION", observationSession, "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        try RoutesAppearanceUITestConditions.prepare(app)
        try NavigationUITestConditions.openTab(app, "overview", markers: ["overview-title"])
        // The health editor is available independently of asynchronous record reads.
        NavigationUITestConditions.route(app, markers: ["overview-metrics-edit"])
        XCTAssertTrue(UITestConditions.exists(node(app, "overview-metrics-edit")), app.debugDescription)
        try NavigationUITestConditions.contentAboveBar(app, scrollID: "navigation-route-scroll", contentID: "overview-metrics-edit", navigationID: "navigation-tab-overview")
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        try NavigationUITestConditions.contentAboveBar(app, scrollID: "navigation-route-scroll", contentID: "records-open-health-library", navigationID: "navigation-tab-records")
        let recording = node(app, "records-new-recording")
        FormUITestConditions.reveal(recording, in: app, scrollID: "navigation-route-scroll", towardTop: true)
        recording.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "recording-controls-fullscreen")))
        XCTAssertTrue(UITestConditions.exists(node(app, "recording-session-panel")))
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["records-title"])
        let schedule = node(app, "records-section-schedule")
        XCTAssertTrue(UITestConditions.exists(schedule), app.debugDescription)
        XCTAssertEqual(schedule.label, "일정")
        try NavigationUITestConditions.openTab(app, "conversation", markers: ["rag-conversation-screen"])
        XCTAssertFalse(node(app, "ai-features-screen").exists)
        XCTAssertFalse(node(app, "external-evidence-search").exists)
        XCTAssertFalse(node(app, "inference-disclosure-sheet").exists)
        XCTAssertFalse(node(app, "navigation-tab-schedule").exists)
        // The material host shares the identifier; only the native UIButton dispatches Send.
        let send = app.buttons.matching(identifier: "rag-conversation-send").firstMatch
        XCTAssertTrue(UITestConditions.exists(send))
        XCTAssertFalse(app.staticTexts["필요하면 동의를 받고 공개 웹자료와 의학 문헌도 찾아요."].firstMatch.exists)
        let input = node(app, "rag-conversation-input")
        // This no-provider case needs only nonempty input to enable Send; keep native character entry short.
        try RoutesVisibleContentUITestConditions.conversationControl(input, in: app)
        input.tap()
        input.typeText("test")
        input.typeText("\n")
        let unsentDraft = try XCTUnwrap(input.value as? String)
        XCTAssertEqual(unsentDraft.trimmingCharacters(in: .whitespacesAndNewlines), "test")
        try RoutesVisibleContentUITestConditions.conversationControl(send, in: app)
        ConversationHitUITestObservation.assertSendReady(app, send: send, session: observationSession, testCase: self)
        XCTAssertFalse(node(app, "rag-conversation-error").exists)
        send.tap()
        try RoutesVisibleContentUITestConditions.conversationMessage(
            identifier: "rag-conversation-error", expected: "대화 기록이나 선택한 AI를 확인하지 못해 전송하지 않았어요. 다시 보내 주세요.", in: app,
        )
        XCTAssertEqual(input.value as? String, unsentDraft)
        XCTAssertFalse(node(app, "conversation-message-body").exists)
        XCTAssertFalse(node(app, "inference-disclosure-sheet").exists)
        // Switching away from the root conversation keeps the unsent draft and local recovery notice without a leave prompt.
        XCTAssertFalse(app.alerts["저장하지 않은 내용이 있어요"].exists)
        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        try NavigationUITestConditions.contentAboveBar(app, scrollID: "navigation-route-scroll", contentID: "settings-app-info", navigationID: "navigation-tab-settings")
        let provider = node(app, "settings-open-provider")
        FormUITestConditions.reveal(provider, in: app, scrollID: "navigation-route-scroll", towardTop: true)
        provider.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "settings-provider-screen")))
        _ = try NavigationUITestConditions.navigationAction(app, "navigation-back")
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        try RoutesVisibleContentUITestConditions.settingsRootAfterProviderBack(in: app)
        try NavigationUITestConditions.openTab(app, "conversation", markers: ["rag-conversation-screen"])
        try RoutesVisibleContentUITestConditions.conversationMessage(
            identifier: "rag-conversation-error", expected: "대화 기록이나 선택한 AI를 확인하지 못해 전송하지 않았어요. 다시 보내 주세요.", in: app,
        )
        XCTAssertEqual(input.value as? String, unsentDraft)
        XCTAssertFalse(node(app, "conversation-message-body").exists)
        XCTAssertFalse(node(app, "inference-disclosure-sheet").exists)
        XCTAssertFalse(app.alerts["저장하지 않은 내용이 있어요"].exists)
        try openSchedule(app)
        XCTAssertTrue(node(app, "schedule-open-appointments").exists)
        UITestConditions.value(node(app, "calendar-title"), equals: "일정")
        XCTAssertFalse(node(app, "calendar-connect").exists)
        RecordingFixtureUITestConditions.capture(app, "default-ai-route-recovery-and-calendar-linking", testCase: self)
    }

    /// Inspect retained production routes in both appearances without starting a provider request.
    @MainActor
    func testAiScreensAndSeparateHistoriesAcrossAppearanceChanges() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "ai-feature-visit-questions", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + AppearanceUITestConditions.observationArguments
        let session = try XCTUnwrap(ProcessInfo.processInfo.environment["OROT_IOS_FIXTURE_SESSION"])
        _ = try XCTUnwrap(UUID(uuidString: session))
        app.launchArguments += ["-OROT_ROUTES_GENERATED_RECORDS", "synthetic", "-OROT_ROUTES_FIXTURE_SESSION", session]
        app.launch()
        var original: AppearanceUITestConditions.Snapshot?
        defer {
            if let original {
                do { try AppearanceUITestConditions.restore(original, returningTo: app, testCase: self) }
                catch { XCTFail("Could not restore owned Simulator appearance: \(error)") }
            }
            UITestConditions.terminateStandaloneApp(app)
        }
        try RoutesAppearanceUITestConditions.prepare(app)
        XCTAssertTrue(UITestConditions.exists(node(app, "rag-conversation-screen")))
        for dark in [false, true] {
            _ = try AppearanceUITestConditions.select(dark, returningTo: app, testCase: self, captureOriginal: {
                if original == nil {
                    original = $0
                }
            })
            let suffix = dark ? "dark" : "light"
            try NavigationUITestConditions.openTab(app, "conversation", markers: ["rag-conversation-screen"])
            try captureAppearance(app, "conversation-empty-\(suffix)")
            try GeneratedRecordsRoutesUITestConditions.inspect(app, suffix: suffix, testCase: self)
            try openSchedule(app)
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

    /// Numeric records are covered below native; period tabs preserve numeric layout and horizontal interaction in both themes.
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
            for (mode, value) in [("medication", "1 정"), ("sleep", "코어 수면"), ("period", "집계 기간"), ("loading", ""), ("missing", ""), ("changed", ""), ("unavailable", "")] {
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

    /// Schedule is a Records section; exercise its native control before checking the calendar route.
    @MainActor
    private func openSchedule(_ app: XCUIApplication) throws {
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        let schedule = node(app, "records-section-schedule")
        XCTAssertTrue(UITestConditions.exists(schedule), app.debugDescription)
        XCTAssertEqual(schedule.label, "일정")
        XCTAssertTrue(schedule.isEnabled && schedule.isHittable && app.frame.contains(schedule.frame))
        schedule.tap()
        NavigationUITestConditions.route(app, markers: ["calendar-title"])
    }

    @MainActor
    private func captureAppearance(_ app: XCUIApplication, _ name: String) throws {
        // A mounted React scene may still have its detached zero-inset frame during the native push.
        // Capture only after the actual toolbar and the conversation's safe-area frame are installed.
        if name.hasPrefix("conversation-empty-") {
            _ = try NavigationUITestConditions.navigationAction(app, "navigation-tab-conversation")
            let scene = node(app, "rag-conversation-screen")
            let attached = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                scene.exists && scene.frame.minY > app.frame.minY
            }, object: nil)
            XCTAssertEqual(UITestConditions.wait(for: [attached]), .completed)
        } else {
            _ = try NavigationUITestConditions.navigationAction(app, "navigation-back")
        }
        RecordingFixtureUITestConditions.capture(app, name, testCase: self)
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }
}
