import XCTest

/// Synthetic provider failures retain disclosure and classification boundaries without sending health data remotely.
final class AppointmentConsentUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testDisclosureBlocksProviderUntilApprovalAndNeverSavesFailedClassification() {
        let app = XCUIApplication()
        defer {
            XCUIDevice.shared.orientation = .portrait
            app.terminate()
        }
        let fixture = ClassificationConsentUITestSupport.launch(app)
        defer { ClassificationConsentUITestSupport.cleanup(app, fixture: fixture, testCase: self) }
        DisclosureLayoutUITestObservations.startClassification(app, in: self)
        failureNotice(app, reason: "이 요청의 AI 처리 승인이 필요해요.")
        ClassificationConsentUITestSupport.assertBlocked(app, testCase: self)
        ClassificationConsentUITestSupport.openSettingsChoice(app, testCase: self)
        ClassificationConsentUITestSupport.assertSettingsControls(app, testCase: self)
        tap(app, "provider-selection-cancel")
        tap(app, "classification-close-settings")

        let page = node(app, "medical-appointment-fullscreen")
        let compactWidth = page.frame.width
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForWidthChange(page, from: compactWidth)
        XCTAssertTrue(node(app, "medical-appointment-import").isHittable)
        XCTAssertFalse(node(app, "medical-appointment-manual").exists)
        NavigationGeometryUITestConditions.captureScreen(app, name: "classification-actions-after-rotation", testCase: self)
        ClassificationConsentUITestSupport.openSettingsChoice(app, testCase: self)
        ClassificationConsentUITestSupport.assertSettingsControls(app, testCase: self)
        tap(app, "provider-selection-confirm")
        XCTAssertTrue(node(app, "calendar-current-model").waitForAppearance())
        tap(app, "classification-close-settings")
        let expandedWidth = page.frame.width
        XCUIDevice.shared.orientation = .portrait
        waitForWidthChange(page, from: expandedWidth)

        DisclosureLayoutUITestObservations.startClassification(app, in: self)
        failureNotice(app, reason: "선택한 AI의 응답을 받지 못했어요.")
        UITestConditions.value(node(app, "calendar-classification-synthetic-provider-calls"), equals: "syntheticProviderCalls=1")
        UITestConditions.value(node(app, "classification-synthetic-payload-privacy"), equals: "syntheticHealthIncluded=true;syntheticIdentifierExcluded=true")
        XCTAssertFalse(node(app, "inference-disclosure-sheet").exists)
        XCTAssertFalse(node(app, "calendar-classification-synthetic-calendar-save").exists)
        XCTAssertFalse(node(app, "medical-appointment-save-calendar-candidate-1").exists)
        XCTAssertFalse(node(app, "medical-appointment-manual").exists)
        XCTAssertTrue(node(app, "medical-appointment-results").waitForAppearance())
        NavigationGeometryUITestConditions.captureScreen(app, name: "failed-classification-retains-retry", testCase: self)
    }

    @MainActor
    func testClassificationReturnsThroughScheduleToHome() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        launch(app, probe: "medical-appointment-app-navigation", observeGeometry: true)
        // Fresh fixtures must finish the real appearance choice before the default conversation opens.
        tap(app, "별")
        tap(app, "assistant-appearance-save")
        XCTAssertTrue(node(app, "rag-conversation-screen").waitForAppearance())
        try NavigationUITestConditions.openTab(app, "schedule", markers: ["calendar-title"])
        tap(app, "open-medical-appointments")
        DisclosureLayoutUITestObservations.assertClassificationText(app, contains: "기기 안에서 분류해요.", in: self)
        // Measure real child viewports separately from the route and Back recovery assertions.
        try NavigationGeometryUITestConditions.captureChildBoundary(app, viewportIDs: ["medical-appointment-fullscreen"], name: "appointment-classification-boundary", testCase: self)
        XCTAssertFalse(node(app, "medical-appointment-manual").exists)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        XCTAssertTrue(node(app, "calendar-title").waitForAppearance())
        tap(app, "open-medical-appointments")
        XCTAssertTrue(node(app, "medical-appointment-confirmation").waitForAppearance())
        try NavigationGeometryUITestConditions.captureChildBoundary(app, viewportIDs: ["medical-appointment-fullscreen"], name: "appointment-classification-return-boundary", testCase: self)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        XCTAssertTrue(node(app, "calendar-title").waitForAppearance())
        try NavigationUITestConditions.openTab(app, "overview", markers: ["overview-title"])
        NavigationGeometryUITestConditions.captureScreen(app, name: "manual-classification-schedule-home", testCase: self)
    }

    /// Keeps a synthetic manual draft in the production route's measured content lane through rotation and guarded Back.
    @MainActor
    func testManualAppointmentRetainsDraftAcrossDuoReflow() throws {
        let app = XCUIApplication()
        XCUIDevice.shared.orientation = .portrait
        defer {
            XCUIDevice.shared.orientation = .portrait
            app.terminate()
        }
        // Retained editing still needs its guard/rotation proof, but no public classification action restores it.
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-OROT_E2E_PROBE", "medical-appointment-app-navigation", "-OROT_TEST_RETAINED_APPOINTMENT_ROUTE", "YES"]
        app.launch()
        XCTAssertTrue(node(app, "appointment-add").waitForAppearance())
        tap(app, "appointment-add")
        guard
            FormUITestConditions.replace(node(app, "appointment-clinic-input"), with: "Synthetic Duo clinic", in: app, scrollID: "appointments-scroll"),
            FormUITestConditions.replace(node(app, "appointment-date-input"), with: "2035-06-02", in: app, scrollID: "appointments-scroll"),
            FormUITestConditions.replace(node(app, "appointment-time-input"), with: "09:30", in: app, scrollID: "appointments-scroll"),
            FormUITestConditions.replace(node(app, "appointment-note-input"), with: "Bring the test results.", in: app, scrollID: "appointments-scroll")
        else { return }

        let panel = node(app, "appointments-columns-primary")
        let contentRegion = node(app, "navigation-content-region")
        XCTAssertTrue(panel.exists && contentRegion.exists, app.debugDescription)
        XCTAssertFalse(panel.frame.isEmpty, app.debugDescription)
        XCTAssertLessThanOrEqual(panel.frame.width, contentRegion.frame.width + 1, app.debugDescription)
        let clinic = node(app, "appointment-clinic-input")
        clinic.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForAppearance(), app.debugDescription)
        for identifier in ["appointment-save", "appointment-form-cancel"] {
            let action = node(app, identifier)
            FormUITestConditions.reveal(action, in: app, scrollID: "appointments-scroll")
            XCTAssertTrue(action.exists && action.isHittable, app.debugDescription)
        }
        NavigationGeometryUITestConditions.captureScreen(app, name: "manual-appointment-draft-keyboard-portrait", testCase: self)

        let compactWidth = panel.frame.width
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForWidthChange(panel, from: compactWidth)
        XCTAssertLessThanOrEqual(panel.frame.width, contentRegion.frame.width + 1, app.debugDescription)
        XCTAssertEqual(node(app, "appointment-clinic-input").value as? String, "Synthetic Duo clinic")
        XCTAssertEqual(node(app, "appointment-date-input").value as? String, "2035-06-02")
        XCTAssertEqual(node(app, "appointment-time-input").value as? String, "09:30")
        XCTAssertEqual(node(app, "appointment-note-input").value as? String, "Bring the test results.")
        NavigationGeometryUITestConditions.captureScreen(app, name: "manual-appointment-draft-landscape", testCase: self)

        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        let leavePrompt = app.alerts["저장하지 않은 내용이 있어요"]
        XCTAssertTrue(leavePrompt.waitForAppearance(), app.debugDescription)
        leavePrompt.buttons["계속 편집"].tap()
        XCTAssertEqual(node(app, "appointment-clinic-input").value as? String, "Synthetic Duo clinic")
        tap(app, "appointment-form-cancel")
        XCTAssertTrue(node(app, "appointments-empty").waitForAppearance(), app.debugDescription)
        NavigationGeometryUITestConditions.captureScreen(app, name: "manual-appointment-cancel-keeps-route", testCase: self)

        // These writes stay in the probe's session-only repository, away from encrypted user storage.
        let appointmentId = try ReminderJourneyForm.create(
            app,
            clinic: "Saved synthetic clinic",
            start: ReminderJourneyForm.time(minutesAhead: 480),
            note: "Saved synthetic note",
        )
        let savedClinic = node(app, "appointment-clinic-" + appointmentId)
        XCTAssertTrue(savedClinic.waitForAppearance(), app.debugDescription)
        XCTAssertEqual(savedClinic.label, "Saved synthetic clinic")

        ReminderJourneyForm.edit(
            app,
            id: appointmentId,
            start: ReminderJourneyForm.time(minutesAhead: 960),
            clinic: "Edited synthetic clinic",
        )
        XCTAssertEqual(savedClinic.label, "Edited synthetic clinic")
        XCTAssertTrue(app.staticTexts[ReminderJourneyForm.note].waitForAppearance(), app.debugDescription)
        NavigationGeometryUITestConditions.captureScreen(app, name: "manual-appointment-edit-saved", testCase: self)
    }

    /// Real settings disclosure replaces the removed per-request preview modal.
    @MainActor
    func testSettingsDisclosureAndDeclineAcrossAppearances() throws {
        let app = XCUIApplication()
        let fixture = ClassificationConsentUITestSupport.launch(app, extra: AppearanceUITestConditions.observationArguments)
        var original: AppearanceUITestConditions.Snapshot?
        defer {
            if let original {
                do { try AppearanceUITestConditions.restore(original, returningTo: app, testCase: self) }
                catch { XCTFail("Could not restore owned Simulator appearance: \(error)") }
            }
            ClassificationConsentUITestSupport.cleanup(app, fixture: fixture, testCase: self)
        }
        for dark in [false, true] {
            _ = try AppearanceUITestConditions.select(dark, returningTo: app, testCase: self, captureOriginal: {
                if original == nil {
                    original = $0
                }
            })
            ClassificationConsentUITestSupport.openSettingsChoice(app, testCase: self)
            ClassificationConsentUITestSupport.assertSettingsControls(app, testCase: self)
            let disclosure = node(app, "model-settings-transmission-disclosure")
            XCTAssertTrue(UITestConditions.text(disclosure).contains("OpenAI API"))
            XCTAssertFalse(UITestConditions.text(disclosure).contains("SENTINEL_CALENDAR_EVENT_IDENTIFIER"))
            NavigationGeometryUITestConditions.captureScreen(app, name: dark ? "settings-classification-consent-dark" : "settings-classification-consent-light", testCase: self)
            tap(app, "provider-selection-cancel")
            tap(app, "classification-close-settings")
            DisclosureLayoutUITestObservations.startClassification(app, in: self)
            failureNotice(app, reason: "이 요청의 AI 처리 승인이 필요해요.")
            ClassificationConsentUITestSupport.assertBlocked(app, testCase: self)
        }
    }

    @MainActor
    private func launch(_ app: XCUIApplication, probe: String, observeGeometry: Bool = false) {
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-OROT_E2E_PROBE", probe, "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        if observeGeometry {
            app.launchArguments += ["-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES"]
        }
        app.launch()
    }

    /// Shares the fixture's failure-copy assertion with the disclosure observation helper.
    @MainActor
    func failureNotice(_ app: XCUIApplication, reason: String) {
        ClassificationFailureNoticeUITestSupport.assertNotice(app, reason: reason, testCase: self)
    }

    @MainActor
    func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }

    @MainActor
    func tap(_ app: XCUIApplication, _ id: String) {
        let target = node(app, id)
        XCTAssertTrue(target.waitForAppearance(), app.debugDescription)
        UITestConditions.scrollTo(target, in: app)
        target.tap()
    }

    @MainActor
    private func waitForWidthChange(_ element: XCUIElement, from width: CGFloat) {
        let changed = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in abs(element.frame.width - width) > 1 },
            object: nil,
        )
        XCTAssertEqual(UITestConditions.wait(for: [changed]), .completed)
    }
}
