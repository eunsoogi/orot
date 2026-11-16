import XCTest

/// Exercises preserved originals through Memory and the real encrypted local repository.
final class ManualHistoryUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testKnownDateProvenanceAndCorrectionSurviveProcessRestart() throws {
        let app = XCUIApplication()
        ManualHistoryUITestSupport.launch(app, largeText: true, initialDate: "2024-02-01")
        defer { app.terminate() }
        try openManualHistory(app)
        tap(app, "manual-history-correct", in: "navigation-route-scroll")

        guard replace(app, "manual-history-title-input", with: "Synthetic history before correction") else { return }
        guard replace(app, "manual-history-details-input", with: "Synthetic details recorded by the user.", multiline: true) else { return }
        // The preserved original has an unknown date; enter a known date through the real control.
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-date-unknown-selected")), app.debugDescription)
        tap(app, "manual-history-date-unknown", in: "navigation-route-scroll")
        ManualHistoryDateSheetUITestSupport.exerciseDismissalsAndSelect(app, day: 9)
        let details = FormUITestConditions.multilineInput(app, identifier: "manual-history-details-input")
        FormUITestConditions.reveal(details, in: app, scrollID: "navigation-route-scroll")
        details.tap()
        XCTAssertTrue(UITestConditions.exists(app.keyboards.firstMatch), app.debugDescription)
        let save = UITestConditions.element(app, "manual-history-save")
        FormUITestConditions.reveal(save, in: app, scrollID: "navigation-route-scroll")
        XCTAssertTrue(save.isHittable)
        NavigationGeometryUITestConditions.captureScreen(app, name: "manual-history-large-text-keyboard-save", testCase: self)
        save.tap()

        visible(app, "Synthetic history before correction")
        visible(app, "기준일: 2024-02-09")
        visible(app, "직접 입력 · 미확인")
        tap(app, "manual-history-correct", in: "navigation-route-scroll")
        guard replace(app, "manual-history-title-input", with: "Synthetic corrected history") else { return }
        guard replace(app, "manual-history-details-input", with: "Synthetic corrected details.", multiline: true) else { return }
        ManualHistoryDateSheetUITestSupport.select(app, day: 10)
        guard replace(app, "manual-history-correction-note-input", with: "Corrected synthetic wording.") else { return }
        tap(app, "manual-history-save", in: "navigation-route-scroll")
        visible(app, "Synthetic history before correction")
        visible(app, "Synthetic corrected history")
        visible(app, "기준일: 2024-02-09")
        visible(app, "기준일: 2024-02-10")
        visible(app, "직접 입력 · 미확인")

        app.terminate()
        ManualHistoryUITestSupport.launch(app)
        try openManualHistory(app, title: "Synthetic corrected history")
        visible(app, "Synthetic corrected history")
        visible(app, "기준일: 2024-02-10")
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-correction-history")))
        visible(app, "Synthetic history before correction")
        visible(app, "Synthetic corrected history")
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["수정 메모: Corrected synthetic wording."]))
    }

    @MainActor
    func testUnknownDateAndConfirmedLineageDeletionSurviveProcessRestart() throws {
        let app = XCUIApplication()
        ManualHistoryUITestSupport.launch(app, seed: "unknown")
        defer { app.terminate() }
        try openManualHistory(app, title: "Synthetic unknown original")
        tap(app, "manual-history-correct", in: "navigation-route-scroll")
        guard replace(app, "manual-history-title-input", with: "Synthetic unknown history") else { return }
        guard replace(app, "manual-history-details-input", with: "Synthetic details without a known date.", multiline: true) else { return }
        tap(app, "manual-history-save", in: "navigation-route-scroll")
        visible(app, "기준일을 모름")
        visible(app, "직접 입력 · 미확인")

        tap(app, "manual-history-correct", in: "navigation-route-scroll")
        guard replace(app, "manual-history-title-input", with: "Synthetic corrected unknown history") else { return }
        guard replace(app, "manual-history-details-input", with: "Synthetic corrected details without a known date.", multiline: true) else { return }
        guard replace(app, "manual-history-correction-note-input", with: "Kept the date unknown.") else { return }
        tap(app, "manual-history-save", in: "navigation-route-scroll")
        visible(app, "기준일을 모름")
        tap(app, "manual-history-delete", in: "navigation-route-scroll")
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-delete-confirmation")))
        tap(app, "manual-history-cancel-delete", in: "navigation-route-scroll")
        visible(app, "Synthetic corrected unknown history")
        tap(app, "manual-history-delete", in: "navigation-route-scroll")
        tap(app, "manual-history-confirm-delete", in: "navigation-route-scroll")
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["이 기억은 더 이상 볼 수 없어요."]))

        app.terminate()
        ManualHistoryUITestSupport.launch(app, seed: "unknown")
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "saved-memory-browser")))
        XCTAssertFalse(app.staticTexts["Synthetic unknown history"].exists)
        XCTAssertFalse(app.staticTexts["Synthetic corrected unknown history"].exists)
    }

    @MainActor
    func testUnsavedDraftRequiresConfirmationBeforeLeavingManualHistory() throws {
        let app = XCUIApplication()
        ManualHistoryUITestSupport.launch(app, seed: "draft")
        defer { app.terminate() }
        try openManualHistory(app, title: "Synthetic draft original")
        tap(app, "manual-history-correct", in: "navigation-route-scroll")
        guard replace(app, "manual-history-title-input", with: "Synthetic unsaved draft") else { return }

        ManualHistoryBackUITestSupport.swipeBack(app)
        let leavePrompt = app.alerts["저장하지 않은 내용이 있어요"]
        XCTAssertTrue(UITestConditions.exists(leavePrompt), app.debugDescription)
        leavePrompt.buttons["계속 편집"].tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-title-input")))
        XCTAssertEqual(UITestConditions.element(app, "manual-history-title-input").value as? String, "Synthetic unsaved draft")

        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        let confirmLeave = app.alerts["저장하지 않은 내용이 있어요"].buttons["내용 버리고 나가기"]
        XCTAssertTrue(UITestConditions.exists(confirmLeave), app.debugDescription)
        confirmLeave.tap()
        NavigationUITestConditions.route(app, markers: ["records-title"])
        try openManualHistory(app, title: "Synthetic draft original")
        XCTAssertFalse(app.staticTexts["Synthetic unsaved draft"].exists)
    }

    @MainActor
    func testContextualBackAndHomeHonorDepartureConfirmationInRightRail() throws {
        let app = XCUIApplication()
        ManualHistoryUITestSupport.launch(app, observeGeometry: true, seed: "rail")
        defer { app.terminate() }
        try openManualHistory(app, title: "Synthetic rail original")
        // Observe the list and edited form independently from the departure guard's state assertions.
        try NavigationGeometryUITestConditions.captureChildBoundary(app, viewportIDs: ["navigation-route-scroll"], name: "manual-history-list-boundary", testCase: self)
        tap(app, "manual-history-correct", in: "navigation-route-scroll")
        guard replace(app, "manual-history-title-input", with: "Synthetic rail draft") else { return }
        try NavigationGeometryUITestConditions.captureChildBoundary(app, viewportIDs: ["navigation-route-scroll"], name: "manual-history-edited-draft-boundary", testCase: self)

        let back = try NavigationUITestConditions.navigationAction(app, "navigation-back")
        // Keep the native rail's VoiceOver name and the route's discard guard.
        XCTAssertEqual(back.toolbar.frame.width, 48, accuracy: 0.5)
        XCTAssertGreaterThan(back.toolbar.frame.midX, app.frame.midX)
        XCTAssertEqual(back.control.label, "이전 화면으로 돌아가기")
        XCTAssertFalse(app.buttons["navigation-home"].exists)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        let leavePrompt = app.alerts["저장하지 않은 내용이 있어요"]
        XCTAssertTrue(UITestConditions.exists(leavePrompt), app.debugDescription)
        leavePrompt.buttons["계속 편집"].tap()
        XCTAssertEqual(UITestConditions.element(app, "manual-history-title-input").value as? String, "Synthetic rail draft")
        try NavigationGeometryUITestConditions.captureChildBoundary(app, viewportIDs: ["navigation-route-scroll"], name: "manual-history-retained-draft-boundary", testCase: self)

        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        let confirmLeave = app.alerts["저장하지 않은 내용이 있어요"].buttons["내용 버리고 나가기"]
        XCTAssertTrue(UITestConditions.exists(confirmLeave), app.debugDescription)
        confirmLeave.tap()
        NavigationUITestConditions.route(app, markers: ["records-title"])
        XCTAssertFalse(UITestConditions.element(app, "manual-history-title-input").exists)
    }

    @MainActor
    func testRouteOpenFailureRetryAndBackAfterDuoReflow() throws {
        let app = XCUIApplication()
        XCUIDevice.shared.orientation = .portrait
        ManualHistoryUITestSupport.launch(app, largeText: true, scenario: "manual-history-recovery", observeAppearance: true, seed: "recovery")
        var originalAppearance: AppearanceUITestConditions.Snapshot?
        defer {
            if let originalAppearance {
                try? AppearanceUITestConditions.restore(originalAppearance, returningTo: app, testCase: self)
            }
            app.terminate()
            XCUIDevice.shared.orientation = .portrait
        }

        // Select appearance before the one-shot failure: background/foreground correctly retries Memory reads.
        _ = try AppearanceUITestConditions.select(
            true,
            returningTo: app,
            testCase: self,
            captureOriginal: { originalAppearance = $0 },
        )
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        let error = app.staticTexts["기억을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."]
        let retry = app.buttons["다시 시도"]
        XCTAssertTrue(UITestConditions.exists(error) && retry.isHittable, app.debugDescription)

        let portraitWidth = app.frame.width
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let frame = app.frame
            return frame.width > frame.height && abs(frame.width - portraitWidth) > 0.5
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [landscape]), .completed)
        XCTAssertTrue(retry.isHittable, app.debugDescription)

        retry.tap()
        try openManualHistory(app, title: "Synthetic recovery original")
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["records-title"])
    }

    @MainActor
    private func openManualHistory(_ app: XCUIApplication, title: String = "Synthetic known original") throws {
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        XCTAssertFalse(UITestConditions.element(app, "records-open-manual-history").exists)
        // Stable identity lets the existing window-owner guard select the real route surface.
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label BEGINSWITH %@", "saved-memory-entry-", title)).firstMatch
        XCTAssertTrue(UITestConditions.exists(row), app.debugDescription)
        FormUITestConditions.reveal(row, in: app, scrollID: "navigation-route-scroll")
        XCTAssertTrue(row.isHittable)
        row.tap()
        NavigationUITestConditions.route(app, markers: ["history-memory-detail"])
        XCTAssertFalse(UITestConditions.element(app, "manual-history-add").exists)
    }

    @MainActor
    private func replace(_ app: XCUIApplication, _ identifier: String, with text: String, multiline: Bool = false) -> Bool {
        let input = multiline
            ? FormUITestConditions.multilineInput(app, identifier: identifier)
            : app.textFields.matching(identifier: identifier).firstMatch
        XCTAssertTrue(UITestConditions.exists(input), app.debugDescription)
        return FormUITestConditions.replace(input, with: text, in: app, scrollID: "navigation-route-scroll")
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
    private func visible(_ app: XCUIApplication, _ label: String) {
        let text = app.staticTexts.matching(NSPredicate(format: "label == %@", label)).firstMatch
        XCTAssertTrue(UITestConditions.exists(text), app.debugDescription)
        FormUITestConditions.reveal(text, in: app, scrollID: "navigation-route-scroll", towardTop: true)
        XCTAssertTrue(text.isHittable)
    }
}
