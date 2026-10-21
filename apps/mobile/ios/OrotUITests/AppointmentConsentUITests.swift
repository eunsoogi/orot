import XCTest

/// Synthetic provider failures retain the disclosure and manual-entry boundaries without sending health data remotely.
final class AppointmentConsentUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testDisclosureBlocksProviderUntilApprovalAndNeverSavesFailedClassification() {
        let app = XCUIApplication()
        defer { app.terminate() }
        launch(app, probe: "medical-appointment-classification")
        tap(app, "medical-appointment-import")
        XCTAssertTrue(node(app, "inference-disclosure-sheet").waitForAppearance())
        tap(app, "inference-disclosure-expand")
        let preview = node(app, "inference-disclosure-message-1")
        XCTAssertTrue(preview.exists)
        let scroll = node(app, "inference-disclosure-preview")
        scroll.swipeUp()
        let request = UITestConditions.text(preview)
        XCTAssertTrue(request.contains("SENTINEL_HEALTH_VALUE"), request)
        XCTAssertFalse(request.contains("SENTINEL_CALENDAR_EVENT_IDENTIFIER"), request)
        tap(app, "inference-disclosure-cancel")
        failureNotice(app, reason: "이 요청의 AI 처리 승인이 필요해요.")
        UITestConditions.value(node(app, "calendar-classification-synthetic-provider-calls"), equals: "syntheticProviderCalls=0")
        tap(app, "medical-appointment-import")
        XCTAssertTrue(node(app, "inference-disclosure-sheet").waitForAppearance())
        tap(app, "inference-disclosure-allow")
        failureNotice(app, reason: "선택한 AI의 응답을 받지 못했어요.")
        UITestConditions.value(node(app, "calendar-classification-synthetic-provider-calls"), equals: "syntheticProviderCalls=1")
        XCTAssertFalse(node(app, "calendar-classification-synthetic-calendar-save").exists)
        XCTAssertFalse(node(app, "medical-appointment-save-calendar-candidate-1").exists)
        tap(app, "medical-appointment-manual")
        XCTAssertTrue(node(app, "calendar-classification-synthetic-manual-entry").exists)
        capture(app, "failed-classification-retains-manual-entry")
    }

    @MainActor
    func testManualPageReturnsThroughClassificationAndScheduleToHome() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        launch(app, probe: "medical-appointment-app-navigation")
        XCTAssertTrue(node(app, "welcome-title").waitForAppearance())
        try NavigationUITestConditions.openTab(app, "schedule", markers: ["calendar-title"])
        tap(app, "open-medical-appointments")
        XCTAssertTrue(app.staticTexts["기기 안에서 분류해요."].waitForAppearance())
        tap(app, "medical-appointment-manual")
        XCTAssertTrue(node(app, "appointment-add").waitForAppearance())
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        XCTAssertTrue(node(app, "medical-appointment-manual").waitForAppearance())
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        XCTAssertTrue(node(app, "calendar-title").waitForAppearance())
        try NavigationUITestConditions.openTab(app, "home", markers: ["welcome-title"])
        capture(app, "manual-classification-schedule-home")
    }

    /// Decline both rendered appearances; this verifies the actual disclosure without any provider send.
    @MainActor
    func testDisclosureCollapsedAndExpandedAcrossAppearances() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-OROT_E2E_PROBE", "medical-appointment-classification", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + AppearanceUITestConditions.observationArguments
        app.launch()
        var original: AppearanceUITestConditions.Snapshot?
        defer {
            if let original {
                do { try AppearanceUITestConditions.restore(original, returningTo: app, testCase: self) }
                catch { XCTFail("Could not restore owned Simulator appearance: \(error)") }
            }
            app.terminate()
        }
        for dark in [false, true] {
            // The modal intentionally hides the root accessibility marker; switch appearance before opening it.
            _ = try AppearanceUITestConditions.select(dark, returningTo: app, testCase: self, captureOriginal: {
                if original == nil {
                    original = $0
                }
            })
            let suffix = dark ? "dark" : "light"
            tap(app, "medical-appointment-import")
            XCTAssertTrue(node(app, "inference-disclosure-sheet").waitForAppearance())
            XCTAssertTrue(node(app, "inference-disclosure-allow").isEnabled)
            // The sheet is accessible before its presentation finishes; capture only once both actions enter the window.
            let presented = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                ["inference-disclosure-allow", "inference-disclosure-cancel"].allSatisfy {
                    let action = self.node(app, $0)
                    return action.exists && !action.frame.isEmpty && app.frame.contains(action.frame) && action.isHittable
                }
            }, object: nil)
            XCTAssertEqual(UITestConditions.wait(for: [presented]), .completed)
            capture(app, "transfer-consent-collapsed-\(suffix)")
            tap(app, "inference-disclosure-expand")
            let preview = node(app, "inference-disclosure-message-1")
            XCTAssertTrue(preview.waitForAppearance())
            let content = UITestConditions.text(preview)
            XCTAssertTrue(content.contains("SENTINEL_HEALTH_VALUE"))
            XCTAssertFalse(content.contains("SENTINEL_CALENDAR_EVENT_IDENTIFIER"))
            UITestConditions.scrollTo(preview, in: app)
            XCTAssertTrue(preview.isHittable)
            capture(app, "transfer-consent-expanded-\(suffix)")
            tap(app, "inference-disclosure-cancel")
            UITestConditions.value(node(app, "calendar-classification-synthetic-provider-calls"), equals: "syntheticProviderCalls=0")
            XCTAssertFalse(node(app, "inference-disclosure-sheet").exists)
        }
    }

    @MainActor
    private func launch(_ app: XCUIApplication, probe: String) {
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-OROT_E2E_PROBE", probe, "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
    }

    @MainActor
    private func failureNotice(_ app: XCUIApplication, reason: String) {
        // The batch summary includes measured duration; assert its stable failure category, not the retired generic fallback.
        let notice = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@",
                                                          "1번째 묶음 처리 중 ", reason)).firstMatch
        XCTAssertTrue(notice.waitForAppearance())
        XCTAssertTrue(notice.label.hasSuffix("완료한 분류는 유지했어요."))
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ id: String) {
        let target = node(app, id)
        XCTAssertTrue(target.waitForAppearance(), app.debugDescription)
        UITestConditions.scrollTo(target, in: app)
        target.tap()
    }

    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
