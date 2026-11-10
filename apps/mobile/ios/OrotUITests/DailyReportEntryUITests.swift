import XCTest

/// Opt in only on a disposable production installation with no configured provider or personal data.
@MainActor
final class DailyReportEntryUITests: XCTestCase {
    func testDailyEntryAndConversationDateSurviveRestart() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["OROT_DAILY_REPORT_PRODUCTION_UI"] == "YES",
                          "Requires an explicitly allocated, empty production Simulator installation")
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.orot.mobile")
        app.launch()
        defer { app.terminate() }

        let homeEntry = UITestConditions.element(app, "home-open-daily-report")
        XCTAssertTrue(homeEntry.waitForAppearance(), app.debugDescription)
        attach(app, name: "daily-report-home-entry")
        XCTAssertTrue(homeEntry.isHittable, homeEntry.debugDescription)
        homeEntry.tap()
        XCTAssertTrue(UITestConditions.element(app, "daily-report-screen").waitForAppearance(), app.debugDescription)

        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        XCTAssertTrue(homeEntry.waitForAppearance(), app.debugDescription)
        try NavigationUITestConditions.openTab(app, "ai", markers: ["rag-conversation-screen"])
        let conversationEntry = UITestConditions.element(app, "daily-report-request")
        XCTAssertTrue(conversationEntry.waitForAppearance(), app.debugDescription)
        attach(app, name: "daily-report-conversation-entry")
        XCTAssertTrue(conversationEntry.isHittable, conversationEntry.debugDescription)
        conversationEntry.tap()
        let date = UITestConditions.element(app, "daily-report-date")
        XCTAssertTrue(date.waitForAppearance(), app.debugDescription)
        let originalDate = UITestConditions.text(date)
        XCTAssertFalse(originalDate.isEmpty, date.debugDescription)
        attach(app, name: "daily-report-before-restart")

        // Relaunch the same installation without a fixture reset so Keychain must retain the entry.
        app.terminate()
        app.launch()
        let restoredDate = UITestConditions.element(app, "daily-report-date")
        XCTAssertTrue(restoredDate.waitForAppearance(), app.debugDescription)
        XCTAssertEqual(UITestConditions.text(restoredDate), originalDate, app.debugDescription)
        attach(app, name: "daily-report-after-restart")
    }

    /// The visual fixture provides synthetic lookup data; it does not establish persistence or model behavior.
    func testSavedReportAndFollowUpFitDuoAtLargeTextInBothAppearances() throws {
        let app = XCUIApplication()
        app.launchArguments = visualArguments + ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] + AppearanceUITestConditions.observationArguments
        app.launch()
        var original: AppearanceUITestConditions.Snapshot?
        defer {
            XCUIDevice.shared.orientation = .portrait
            if let original {
                do { try AppearanceUITestConditions.restore(original, returningTo: app, testCase: self) }
                catch { XCTFail("Could not restore device appearance: \(error)") }
            }
            UITestConditions.terminateStandaloneApp(app)
        }
        let scroll = UITestConditions.element(app, "daily-report-screen")
        XCTAssertTrue(UITestConditions.exists(scroll), app.debugDescription)
        for dark in [false, true] {
            _ = try AppearanceUITestConditions.select(dark, returningTo: app, testCase: self, captureOriginal: {
                if original == nil {
                    original = $0
                }
            })
            try assertSavedReport(app, scroll: scroll)
            attach(app, name: dark ? "daily-report-large-dark" : "daily-report-large-light")
        }
        let before = app.frame
        XCUIDevice.shared.orientation = .landscapeLeft
        let rotated = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let frame = app.frame
            return frame.width > frame.height && (abs(frame.width - before.width) > 0.5 || abs(frame.height - before.height) > 0.5)
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [rotated]), .completed)
        try assertSavedReport(app, scroll: scroll)
        attach(app, name: "daily-report-duo-landscape")
        let chat = app.buttons["이 보고서에 관해 대화하기"]
        UITestConditions.scrollTo(chat, in: scroll)
        XCTAssertTrue(chat.exists && chat.isHittable, chat.debugDescription)
        XCTAssertGreaterThanOrEqual(chat.frame.height, 44)
        let rail = try NavigationUITestConditions.navigationAction(app, "navigation-tab-ai").toolbar
        XCTAssertLessThanOrEqual(chat.frame.maxX, rail.frame.minX + 0.5)
        chat.tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "rag-conversation-screen")), app.debugDescription)
        XCTAssertTrue(UITestConditions.exists(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "선택한 보고서: 2035-01-01 · Asia/Seoul")).firstMatch))
        let input = UITestConditions.element(app, "rag-conversation-input")
        XCTAssertTrue(input.exists && input.isHittable, input.debugDescription)
        input.tap()
        input.typeText("Synthetic question")
        let send = app.buttons["rag-conversation-send"]
        XCTAssertTrue(send.exists && send.isHittable, send.debugDescription)
        send.tap()
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["합성 보고서 대화 연결을 확인했어요."]), app.debugDescription)
        attach(app, name: "daily-report-follow-up")
    }

    /// Actual spoken output and next-element navigation are distinct from the AX label checks above.
    func testVoiceOverReadsSavedReportAndOpensFollowUp() throws {
        guard #available(iOS 27.0, *) else { XCTFail("This probe requires the iOS VoiceOver test service"); return }
        let session = VoiceOverTestSession()
        session.registerRestoration(in: self)
        try session.prepareForStandardInteraction()
        let app = XCUIApplication()
        app.launchArguments = visualArguments
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        let scroll = UITestConditions.element(app, "daily-report-screen")
        XCTAssertTrue(UITestConditions.exists(scroll), app.debugDescription)
        let heading = app.staticTexts["일일 보고서"]
        try session.assertSpeech(from: heading, expected: "일일 보고서", forbiddenTerms: [], phase: "daily-report-heading", testCase: self)
        let next = try XCUIDevice.shared.voiceOverService.moveForward()
        assertVoiceOverSpeechOutput(next, expected: "2035-01-01", phase: "daily-report-date", testCase: self)
        try session.prepareForStandardInteraction()
        let chat = app.buttons["이 보고서에 관해 대화하기"]
        UITestConditions.scrollTo(chat, in: scroll)
        try session.assertSpeech(from: chat, expected: "이 보고서에 관해 대화하기", forbiddenTerms: [], phase: "daily-report-chat", testCase: self)
        chat.doubleTap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "rag-conversation-screen")), app.debugDescription)
        attach(app, name: "daily-report-voiceover-follow-up")
    }

    /// Seed once through SQLCipher, then reopen without writes in a different app process.
    func testEncryptedSavedReportSurvivesRestartAcrossEntryPaths() throws {
        let app = XCUIApplication()
        defer { UITestConditions.terminateStandaloneApp(app) }
        app.launchArguments = visualArguments + ["-OROT_DAILY_REPORT_PERSISTENCE", "seed"]
        app.launch()
        let snapshot = UITestConditions.element(app, "daily-report-persistence-snapshot")
        let process = UITestConditions.element(app, "daily-report-persistence-process")
        XCTAssertTrue(UITestConditions.exists(snapshot) && UITestConditions.exists(process), app.debugDescription)
        let original = UITestConditions.text(snapshot)
        let originalProcess = UITestConditions.text(process)
        XCTAssertFalse(originalProcess.isEmpty)
        let saved = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(original.utf8)) as? [String: Any])
        XCTAssertEqual(saved["runId"] as? String, "synthetic-report")
        XCTAssertEqual(saved["revision"] as? Int, 1)
        let report = try XCTUnwrap(saved["report"] as? [String: Any])
        let observations = try XCTUnwrap(report["observations"] as? [[String: Any]])
        XCTAssertEqual(observations.first?["text"] as? String, "합성 심박수 기록은 72회예요.")
        let reportScreen = UITestConditions.element(app, "daily-report-screen")
        XCTAssertTrue(UITestConditions.exists(reportScreen), app.debugDescription)
        // Fabric exposes this same rendered text as nested accessibility elements.
        let record = reportScreen.staticTexts.matching(identifier: "합성 심박수 기록은 72회예요.").firstMatch
        UITestConditions.scrollTo(record, in: reportScreen)
        XCTAssertTrue(record.exists && record.isHittable, record.debugDescription)
        let chat = app.buttons["이 보고서에 관해 대화하기"]
        UITestConditions.scrollTo(chat, in: reportScreen)
        chat.tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "rag-conversation-screen")), app.debugDescription)
        XCTAssertTrue(UITestConditions.exists(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "선택한 보고서: 2035-01-01 · Asia/Seoul")).firstMatch))
        attach(app, name: "daily-report-persistence-seed")

        app.terminate()
        app.launchArguments = visualArguments + ["-OROT_DAILY_REPORT_PERSISTENCE", "read"]
        app.launch()
        XCTAssertTrue(UITestConditions.exists(snapshot) && UITestConditions.exists(process), app.debugDescription)
        XCTAssertNotEqual(UITestConditions.text(process), originalProcess)
        UITestConditions.value(snapshot, equals: original)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "rag-conversation-screen")), app.debugDescription)
        let open = UITestConditions.element(app, "daily-report-request")
        XCTAssertTrue(open.exists && open.isHittable, open.debugDescription)
        open.tap()
        XCTAssertTrue(UITestConditions.exists(reportScreen), app.debugDescription)
        UITestConditions.scrollTo(record, in: reportScreen)
        XCTAssertTrue(record.exists && record.isHittable, record.debugDescription)
        attach(app, name: "daily-report-persistence-readback")
    }

    private var visualArguments: [String] {
        ["-OROT_TEST_SCENARIO", "daily-report-visual", "-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"]
    }

    /// Check the report's real viewport and rail, then preserve screenshots for visual clipping review.
    private func assertSavedReport(_ app: XCUIApplication, scroll: XCUIElement) throws {
        let date = UITestConditions.element(app, "daily-report-date")
        // Fabric exposes this same rendered text as nested accessibility elements.
        let observation = scroll.staticTexts.matching(identifier: "합성 심박수 기록은 72회예요.").firstMatch
        XCTAssertTrue(UITestConditions.exists(date), app.debugDescription)
        XCTAssertTrue(UITestConditions.text(date).contains("2035-01-01"))
        UITestConditions.scrollTo(observation, in: scroll)
        XCTAssertTrue(observation.exists && observation.isHittable, observation.debugDescription)
        let rail = try NavigationUITestConditions.navigationAction(app, "navigation-tab-ai").toolbar
        XCTAssertGreaterThan(rail.frame.height, rail.frame.width, "This observation requires the Duo rail")
        XCTAssertTrue(scroll.frame.intersects(observation.frame))
        XCTAssertTrue(scroll.frame.insetBy(dx: -1, dy: -1).contains(observation.frame), observation.debugDescription)
        XCTAssertLessThanOrEqual(observation.frame.maxX, rail.frame.minX + 0.5)
        XCTAssertTrue(UITestConditions.exists(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "건강 측정: 일부만 포함")).firstMatch))
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "\(name)-accessibility"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
    }
}
