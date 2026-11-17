import XCTest

/// Verifies existing Memory originals and user-stated provenance through Duo reflow.
final class ManualHistoryDuoUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// Capture freshness thresholds before each open; reopened drafts need focus for keyboard geometry.
    @MainActor
    func testOpenDuoPageActionsPreserveDraftAndSave() throws {
        let app = XCUIApplication()
        var originalAppearance: AppearanceUITestConditions.Snapshot?
        launch(app, seed: "Duo-actions")
        defer {
            if let originalAppearance {
                try? AppearanceUITestConditions.restore(originalAppearance, returningTo: app, testCase: self)
            }
            app.terminate()
        }
        _ = try AppearanceUITestConditions.select(false, returningTo: app, testCase: self, captureOriginal: { originalAppearance = $0 })
        try openManualHistory(app, title: "Synthetic Duo-actions original")
        let formOpenedAt = Date().timeIntervalSince1970 * 1000
        tap(app, "manual-history-correct")
        guard replace(app, "manual-history-title-input", with: "Synthetic Duo history") else { return }
        let title = UITestConditions.element(app, "manual-history-title-input")
        try NavigationPageActionUITestConditions.assertBackBeforePageActions(app, pageIDs: ["manual-history-save", "manual-history-form-close", "navigation-page-action-overflow"], sampledAfter: formOpenedAt, testCase: self)
        tap(app, "manual-history-form-close")
        let reopenedFormAt = Date().timeIntervalSince1970 * 1000
        tap(app, "manual-history-correct")
        XCTAssertEqual(title.value as? String, "Synthetic Duo history", app.debugDescription)
        guard replace(app, "manual-history-details-input", with: "Synthetic user-entered details without a known date.", multiline: true) else { return }
        XCTAssertTrue(app.keyboards.firstMatch.exists && UITestConditions.element(app, "manual-history-details-input").isHittable, app.debugDescription)
        try NavigationPageActionUITestConditions.assertBackBeforePageActions(app, pageIDs: ["manual-history-save", "manual-history-form-close", "navigation-page-action-overflow"], sampledAfter: reopenedFormAt, testCase: self)
        tap(app, "manual-history-save")
        visible(app, "Synthetic Duo history")
        visible(app, "기준일을 모름")
        visible(app, "직접 입력 · 미확인")
    }

    @MainActor
    func testSelectedHistorySurvivesMeasuredDuoReflow() throws {
        let originalOrientation = XCUIDevice.shared.orientation
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        var originalAppearance: AppearanceUITestConditions.Snapshot?
        launch(app)
        defer {
            if let originalAppearance {
                try? AppearanceUITestConditions.restore(originalAppearance, returningTo: app, testCase: self)
            }
            app.terminate()
            XCUIDevice.shared.orientation = originalOrientation
        }

        _ = try AppearanceUITestConditions.select(false, returningTo: app, testCase: self, captureOriginal: { originalAppearance = $0 })
        try openManualHistory(app)
        tap(app, "manual-history-correct")
        let formOpenedAt = Date().timeIntervalSince1970 * 1000
        guard replace(app, "manual-history-title-input", with: "Synthetic Duo history") else { return }

        // Reflow the real form while its title remains first responder and the keyboard is visible.
        let title = UITestConditions.element(app, "manual-history-title-input")
        XCTAssertTrue(app.keyboards.firstMatch.exists, app.debugDescription)
        try NavigationPageActionUITestConditions.assertBackBeforePageActions(app, pageIDs: ["manual-history-save", "manual-history-form-close", "navigation-page-action-overflow"], sampledAfter: formOpenedAt, testCase: self)
        let formPortraitSize = app.frame.size
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForOrientation(app, landscape: true, changedFrom: formPortraitSize)
        XCTAssertTrue(app.keyboards.firstMatch.exists, app.debugDescription)
        XCTAssertTrue(title.isHittable, app.debugDescription)
        XCTAssertEqual(title.value as? String, "Synthetic Duo history", app.debugDescription)

        let formLandscapeSize = app.frame.size
        XCUIDevice.shared.orientation = .portrait
        waitForOrientation(app, landscape: false, changedFrom: formLandscapeSize)
        XCTAssertTrue(app.keyboards.firstMatch.exists, app.debugDescription)
        XCTAssertTrue(title.isHittable, app.debugDescription)

        tap(app, "manual-history-form-close")
        tap(app, "manual-history-correct")
        XCTAssertEqual(title.value as? String, "Synthetic Duo history", app.debugDescription)
        guard replace(app, "manual-history-details-input", with: "Synthetic user-entered details without a known date.", multiline: true) else { return }
        tap(app, "manual-history-save")
        visible(app, "Synthetic Duo history")
        visible(app, "기준일을 모름")
        visible(app, "직접 입력 · 미확인")

        _ = try AppearanceUITestConditions.select(true, returningTo: app, testCase: self)
        NavigationGeometryUITestConditions.captureScreen(app, name: "manual-history-inline-dark-details", testCase: self)
        tap(app, "manual-history-correct")
        guard replace(app, "manual-history-title-input", with: "Synthetic corrected Duo history") else { return }
        guard replace(app, "manual-history-details-input", with: "Synthetic corrected user-entered details.", multiline: true) else { return }
        guard replace(app, "manual-history-correction-note-input", with: "Kept the date unknown.") else { return }
        tap(app, "manual-history-save", label: "수정 내용 저장")

        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-correction-history")), app.debugDescription)
        visible(app, "Synthetic Duo history")
        visible(app, "Synthetic corrected Duo history")
        visible(app, "기준일을 모름")
        visible(app, "직접 입력 · 미확인")
        let selectedHistory = UITestConditions.element(app, "history-memory-detail")
        XCTAssertTrue(UITestConditions.exists(selectedHistory), app.debugDescription)
        let portraitSize = app.frame.size

        XCUIDevice.shared.orientation = .landscapeLeft
        waitForOrientation(app, landscape: true, changedFrom: portraitSize)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-correction-history")), app.debugDescription)
        visible(app, "Synthetic corrected Duo history")
        assertDetailsStayInsideList(app)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-correct")), app.debugDescription)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-delete")), app.debugDescription)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "navigation-back")), app.debugDescription)

        let landscapeSize = app.frame.size
        XCUIDevice.shared.orientation = .portrait
        waitForOrientation(app, landscape: false, changedFrom: landscapeSize)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-detail")), app.debugDescription)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-correction-history")), app.debugDescription)
        assertDetailsStayInsideList(app)

        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        launch(app, largeText: true)
        try openManualHistory(app, title: "Synthetic corrected Duo history")
        visible(app, "Synthetic corrected Duo history")
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-correction-history")), app.debugDescription)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-delete")), app.debugDescription)
        assertDetailsStayInsideList(app)
        tap(app, "manual-history-delete")
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-delete-confirmation")), app.debugDescription)
        tap(app, "manual-history-cancel-delete")
        visible(app, "Synthetic corrected Duo history")
    }

    @MainActor
    private func launch(_ app: XCUIApplication, largeText: Bool = false, seed: String = "Duo") {
        // The Duo is the destination; the application fixture itself uses the supported core profile.
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "memory-history", "-OROT_TEST_MEMORY_SEED", seed, "-OROT_TEST_NAVIGATION_OBSERVATION", "YES", "-OROT_TEST_NAVIGATION_FOCUS_OBSERVATION", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ] + AppearanceUITestConditions.observationArguments + (largeText ? ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] : [])
        app.launch()
        NavigationUITestConditions.route(app, markers: ["rag-conversation-screen"])
    }

    @MainActor
    private func openManualHistory(_ app: XCUIApplication, title: String = "Synthetic Duo original") throws {
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        XCTAssertFalse(UITestConditions.element(app, "records-open-manual-history").exists)
        // Stable identity lets the existing window-owner guard select the real route surface.
        let entry = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label BEGINSWITH %@", "saved-memory-entry-", title)).firstMatch
        XCTAssertTrue(UITestConditions.exists(entry), app.debugDescription)
        FormUITestConditions.reveal(entry, in: app, scrollID: "navigation-route-scroll")
        XCTAssertTrue(entry.isHittable, app.debugDescription)
        entry.tap()
        NavigationUITestConditions.route(app, markers: ["history-memory-detail"])
        XCTAssertFalse(UITestConditions.element(app, "manual-history-add").exists)
        let page = UITestConditions.element(app, "navigation-route-scroll")
        XCTAssertTrue(UITestConditions.exists(page), app.debugDescription)
        // The tagged route may expose the UIScrollView itself or its single wrapper.
        XCTAssertTrue(page.elementType == .scrollView || page.scrollViews.count == 1, app.debugDescription)
        XCTAssertLessThanOrEqual(page.scrollViews.count, 1, app.debugDescription)
        XCTAssertEqual(page.scrollViews.firstMatch.scrollViews.count, 0, app.debugDescription)
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
    private func tap(_ app: XCUIApplication, _ identifier: String, label: String? = nil) {
        let pageLabels = ["manual-history-form-close": "취소", "manual-history-save": "수정 내용 저장"]
        if let actionLabel = label ?? pageLabels[identifier] {
            NavigationPageActionUITestConditions.tap(app, id: identifier, label: actionLabel)
            return
        }
        let target = UITestConditions.element(app, identifier)
        XCTAssertTrue(UITestConditions.exists(target), app.debugDescription)
        FormUITestConditions.reveal(target, in: app, scrollID: "navigation-route-scroll")
        XCTAssertTrue(target.isHittable, app.debugDescription)
        target.tap()
    }

    @MainActor
    private func visible(_ app: XCUIApplication, _ label: String) {
        // Match the unchanged visible label and a stable text identity; keep window and viewport guards.
        let text = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@", "manual-history-", label)).firstMatch
        XCTAssertTrue(UITestConditions.exists(text), app.debugDescription)
        FormUITestConditions.reveal(text, in: app, scrollID: "navigation-route-scroll", towardTop: true)
        XCTAssertTrue(text.isHittable, app.debugDescription)
    }

    @MainActor
    private func waitForOrientation(_ app: XCUIApplication, landscape: Bool, changedFrom oldSize: CGSize) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let size = app.frame.size
            let axisChanged = landscape ? size.width > size.height : size.height > size.width
            return axisChanged && (abs(size.width - oldSize.width) > 0.5 || abs(size.height - oldSize.height) > 0.5)
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [expectation]), .completed, app.debugDescription)
    }

    @MainActor
    private func assertDetailsStayInsideList(_ app: XCUIApplication) {
        let list = UITestConditions.element(app, "saved-memory-detail")
        let selected = UITestConditions.element(app, "history-memory-detail")
        XCTAssertTrue(UITestConditions.exists(list) && UITestConditions.exists(selected), app.debugDescription)

        // The original editor remains inside its ID-owned Memory destination after window reflow.
        XCTAssertGreaterThanOrEqual(selected.frame.minY, list.frame.minY - 1, app.debugDescription)
        XCTAssertLessThanOrEqual(selected.frame.maxY, list.frame.maxY + 1, app.debugDescription)
        XCTAssertGreaterThanOrEqual(selected.frame.minX, list.frame.minX - 1, app.debugDescription)
        XCTAssertLessThanOrEqual(selected.frame.maxX, list.frame.maxX + 1, app.debugDescription)
    }
}

enum ManualHistoryBackUITestSupport {
    /// Starts at the window edge while keeping the gesture inside the route viewport.
    @MainActor
    static func swipeBack(_ app: XCUIApplication) {
        XCTAssertFalse(UITestConditions.element(app, "manual-history-back").exists, app.debugDescription)
        let scroll = UITestConditions.element(app, "navigation-route-scroll")
        let frame = scroll.frame
        let window = app.frame
        XCTAssertTrue(!frame.isEmpty && !window.isEmpty, app.debugDescription)
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let y = frame.midY - window.minY
        let start = origin.withOffset(CGVector(dx: window.width * 0.01, dy: y))
        let end = origin.withOffset(CGVector(dx: window.width * 0.91, dy: y))
        start.press(
            forDuration: 0.1,
            thenDragTo: end,
            withVelocity: XCUIGestureVelocity(rawValue: 500),
            thenHoldForDuration: 0,
        )
    }
}
