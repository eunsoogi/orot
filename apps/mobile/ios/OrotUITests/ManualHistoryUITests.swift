import XCTest

/// Exercises manual history through Records and the real encrypted local repository.
final class ManualHistoryUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testKnownDateProvenanceAndCorrectionSurviveProcessRestart() throws {
        let app = XCUIApplication()
        launch(app, largeText: true)
        defer { app.terminate() }
        try openManualHistory(app)
        tap(app, "manual-history-add", in: "manual-history-scroll")

        guard replace(app, "manual-history-title-input", with: "Synthetic history before correction") else { return }
        guard replace(app, "manual-history-details-input", with: "Synthetic details recorded by the user.", multiline: true) else { return }
        guard replace(app, "manual-history-effective-date-input", with: "2024-02-09") else { return }
        XCTAssertTrue(UITestConditions.exists(app.keyboards.firstMatch), app.debugDescription)
        let save = UITestConditions.element(app, "manual-history-save")
        FormUITestConditions.reveal(save, in: app, scrollID: "manual-history-scroll")
        XCTAssertTrue(save.isHittable)
        capture(app, "manual-history-large-text-keyboard-save")
        save.tap()

        visible(app, "Synthetic history before correction")
        visible(app, "기준일: 2024-02-09")
        visible(app, "직접 입력 · 미확인")
        tapDetails(app)
        tap(app, "manual-history-correct", in: "manual-history-scroll")
        guard replace(app, "manual-history-title-input", with: "Synthetic corrected history") else { return }
        guard replace(app, "manual-history-details-input", with: "Synthetic corrected details.", multiline: true) else { return }
        guard replace(app, "manual-history-effective-date-input", with: "2024-02-10") else { return }
        guard replace(app, "manual-history-correction-note-input", with: "Corrected synthetic wording.") else { return }
        tap(app, "manual-history-save", in: "manual-history-scroll")
        visible(app, "Synthetic history before correction")
        visible(app, "Synthetic corrected history")
        visible(app, "기준일: 2024-02-09")
        visible(app, "기준일: 2024-02-10")
        visible(app, "직접 입력 · 미확인")

        app.terminate()
        launch(app)
        try openManualHistory(app)
        visible(app, "Synthetic corrected history")
        visible(app, "기준일: 2024-02-10")
        tapDetails(app)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-correction-history")))
        visible(app, "Synthetic history before correction")
        visible(app, "Synthetic corrected history")
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["수정 메모: Corrected synthetic wording."]))
    }

    @MainActor
    func testUnknownDateAndConfirmedLineageDeletionSurviveProcessRestart() throws {
        let app = XCUIApplication()
        launch(app)
        defer { app.terminate() }
        try openManualHistory(app)
        tap(app, "manual-history-add", in: "manual-history-scroll")
        guard replace(app, "manual-history-title-input", with: "Synthetic unknown history") else { return }
        guard replace(app, "manual-history-details-input", with: "Synthetic details without a known date.", multiline: true) else { return }
        tap(app, "manual-history-date-unknown", in: "manual-history-scroll")
        tap(app, "manual-history-save", in: "manual-history-scroll")
        visible(app, "기준일을 모름")
        visible(app, "직접 입력 · 미확인")

        tapDetails(app)
        tap(app, "manual-history-correct", in: "manual-history-scroll")
        guard replace(app, "manual-history-title-input", with: "Synthetic corrected unknown history") else { return }
        guard replace(app, "manual-history-details-input", with: "Synthetic corrected details without a known date.", multiline: true) else { return }
        guard replace(app, "manual-history-correction-note-input", with: "Kept the date unknown.") else { return }
        tap(app, "manual-history-save", in: "manual-history-scroll")
        visible(app, "기준일을 모름")
        tap(app, "manual-history-delete", in: "manual-history-scroll")
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-delete-confirmation")))
        tap(app, "manual-history-cancel-delete", in: "manual-history-scroll")
        visible(app, "Synthetic corrected unknown history")
        tap(app, "manual-history-delete", in: "manual-history-scroll")
        tap(app, "manual-history-confirm-delete", in: "manual-history-scroll")
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-empty")))

        app.terminate()
        launch(app)
        try openManualHistory(app)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-empty")))
        XCTAssertFalse(app.staticTexts["Synthetic unknown history"].exists)
        XCTAssertFalse(app.staticTexts["Synthetic corrected unknown history"].exists)
    }

    @MainActor
    func testUnsavedDraftRequiresConfirmationBeforeLeavingManualHistory() throws {
        let app = XCUIApplication()
        launch(app)
        defer { app.terminate() }
        try openManualHistory(app)
        tap(app, "manual-history-add", in: "manual-history-scroll")
        guard replace(app, "manual-history-title-input", with: "Synthetic unsaved draft") else { return }

        tap(app, "manual-history-back", in: "manual-history-scroll")
        let leavePrompt = app.alerts["저장하지 않은 내용이 있어요"]
        XCTAssertTrue(UITestConditions.exists(leavePrompt), app.debugDescription)
        leavePrompt.buttons["계속 편집"].tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-title-input")))
        XCTAssertEqual(UITestConditions.element(app, "manual-history-title-input").value as? String, "Synthetic unsaved draft")

        tap(app, "manual-history-back", in: "manual-history-scroll")
        let confirmLeave = app.alerts["저장하지 않은 내용이 있어요"].buttons["내용 버리고 나가기"]
        XCTAssertTrue(UITestConditions.exists(confirmLeave), app.debugDescription)
        confirmLeave.tap()
        NavigationUITestConditions.route(app, markers: ["records-title"])
        try openManualHistory(app)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-empty")))
    }

    @MainActor
    func testContextualBackAndHomeHonorDepartureConfirmationInRightRail() throws {
        let app = XCUIApplication()
        launch(app)
        defer { app.terminate() }
        try openManualHistory(app)
        tap(app, "manual-history-add", in: "manual-history-scroll")
        guard replace(app, "manual-history-title-input", with: "Synthetic rail draft") else { return }

        let back = try NavigationUITestConditions.navigationAction(app, "navigation-back")
        let home = try NavigationUITestConditions.navigationAction(app, "navigation-home")
        // Keep the native rail's VoiceOver names while proving Home does not bypass the route's discard guard.
        XCTAssertEqual(back.toolbar.frame.width, 48, accuracy: 0.5)
        XCTAssertEqual(home.toolbar.frame.width, 48, accuracy: 0.5)
        XCTAssertGreaterThan(back.toolbar.frame.midX, app.frame.midX)
        XCTAssertLessThan(back.control.frame.midY, home.control.frame.midY)
        XCTAssertEqual(back.control.label, "이전 화면으로 돌아가기")
        XCTAssertEqual(home.control.label, "홈 화면으로 이동")
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        let leavePrompt = app.alerts["저장하지 않은 내용이 있어요"]
        XCTAssertTrue(UITestConditions.exists(leavePrompt), app.debugDescription)
        leavePrompt.buttons["계속 편집"].tap()
        XCTAssertEqual(UITestConditions.element(app, "manual-history-title-input").value as? String, "Synthetic rail draft")

        try NavigationUITestConditions.tapNavigation(app, "navigation-home")
        let confirmLeave = app.alerts["저장하지 않은 내용이 있어요"].buttons["내용 버리고 나가기"]
        XCTAssertTrue(UITestConditions.exists(confirmLeave), app.debugDescription)
        confirmLeave.tap()
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        XCTAssertFalse(UITestConditions.element(app, "manual-history-title-input").exists)
    }

    @MainActor
    func testRouteOpenFailureRetryAndBackAfterDuoReflow() throws {
        let app = XCUIApplication()
        XCUIDevice.shared.orientation = .portrait
        launch(app, largeText: true, scenario: "manual-history-recovery", observeAppearance: true)
        var originalAppearance: AppearanceUITestConditions.Snapshot?
        defer {
            if let originalAppearance {
                try? AppearanceUITestConditions.restore(originalAppearance, returningTo: app, testCase: self)
            }
            app.terminate()
            XCUIDevice.shared.orientation = .portrait
        }

        try openManualHistory(app, expectingFailure: true)
        let error = UITestConditions.element(app, "route-load-error-content")
        let retry = UITestConditions.element(app, "route-load-retry")
        XCTAssertTrue(UITestConditions.exists(error) && retry.isHittable, app.debugDescription)
        _ = try AppearanceUITestConditions.select(
            true,
            returningTo: app,
            testCase: self,
            captureOriginal: { originalAppearance = $0 },
        )

        let portraitWidth = app.frame.width
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let frame = app.frame
            return frame.width > frame.height && abs(frame.width - portraitWidth) > 0.5
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [landscape]), .completed)
        XCTAssertTrue(retry.isHittable, app.debugDescription)

        retry.tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-empty")), app.debugDescription)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["records-title"])
    }

    @MainActor
    private func launch(_ app: XCUIApplication, largeText: Bool = false, scenario: String? = nil, observeAppearance: Bool = false) {
        app.launchArguments = [
            scenario == nil ? "-OROT_TEST_PROFILE" : "-OROT_TEST_SCENARIO",
            scenario ?? "core", "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ] + (largeText ? ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] : [])
            + (observeAppearance ? AppearanceUITestConditions.observationArguments : [])
        app.launch()
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
    }

    @MainActor
    private func openManualHistory(_ app: XCUIApplication, expectingFailure: Bool = false) throws {
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "records-open-manual-history", in: "navigation-route-scroll")
        NavigationUITestConditions.route(app, markers: [expectingFailure ? "route-load-error-content" : "manual-history-title"])
    }

    @MainActor
    private func replace(_ app: XCUIApplication, _ identifier: String, with text: String, multiline: Bool = false) -> Bool {
        let input = multiline
            ? FormUITestConditions.multilineInput(app, identifier: identifier)
            : app.textFields.matching(identifier: identifier).firstMatch
        XCTAssertTrue(UITestConditions.exists(input), app.debugDescription)
        return FormUITestConditions.replace(input, with: text, in: app, scrollID: "manual-history-scroll")
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ identifier: String, in scrollID: String) {
        let target = UITestConditions.element(app, identifier)
        XCTAssertTrue(UITestConditions.exists(target), app.debugDescription)
        FormUITestConditions.reveal(target, in: app, scrollID: scrollID)
        XCTAssertTrue(target.isHittable)
        target.tap()
    }

    @MainActor
    private func tapDetails(_ app: XCUIApplication) {
        let details = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "manual-history-details-")).firstMatch
        XCTAssertTrue(UITestConditions.exists(details), app.debugDescription)
        FormUITestConditions.reveal(details, in: app, scrollID: "manual-history-scroll")
        XCTAssertTrue(details.isHittable)
        details.tap()
    }

    @MainActor
    private func visible(_ app: XCUIApplication, _ label: String) {
        let text = app.staticTexts.matching(NSPredicate(format: "label == %@", label)).firstMatch
        XCTAssertTrue(UITestConditions.exists(text), app.debugDescription)
        FormUITestConditions.reveal(text, in: app, scrollID: "manual-history-scroll", towardTop: true)
        XCTAssertTrue(text.isHittable)
    }

    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
