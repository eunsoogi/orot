import XCTest

/// Verifies manual-history selection and user-entered provenance through Duo reflow.
final class ManualHistoryDuoUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testSelectedHistorySurvivesMeasuredDuoReflow() throws {
        let originalOrientation = XCUIDevice.shared.orientation
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        launch(app)
        defer {
            app.terminate()
            XCUIDevice.shared.orientation = originalOrientation
        }

        try openManualHistory(app)
        tap(app, "manual-history-add")
        guard replace(app, "manual-history-title-input", with: "Synthetic Duo history") else { return }

        // Reflow the real form while its title remains first responder and the keyboard is visible.
        let form = UITestConditions.element(app, "manual-history-form")
        let title = UITestConditions.element(app, "manual-history-title-input")
        XCTAssertTrue(UITestConditions.exists(form), app.debugDescription)
        XCTAssertTrue(app.keyboards.firstMatch.exists, app.debugDescription)
        let portraitSize = app.frame.size
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForOrientation(app, landscape: true, changedFrom: portraitSize)
        XCTAssertTrue(app.keyboards.firstMatch.exists, app.debugDescription)
        XCTAssertTrue(title.isHittable, app.debugDescription)
        XCTAssertEqual(title.value as? String, "Synthetic Duo history", app.debugDescription)

        let landscapeSize = app.frame.size
        XCUIDevice.shared.orientation = .portrait
        waitForOrientation(app, landscape: false, changedFrom: landscapeSize)
        XCTAssertTrue(app.keyboards.firstMatch.exists, app.debugDescription)
        XCTAssertTrue(title.isHittable, app.debugDescription)

        tap(app, "manual-history-form-close")
        tap(app, "manual-history-add")
        XCTAssertEqual(title.value as? String, "Synthetic Duo history", app.debugDescription)
        guard replace(app, "manual-history-details-input", with: "Synthetic user-entered details without a known date.", multiline: true) else { return }
        tap(app, "manual-history-date-unknown")
        tap(app, "manual-history-save")
        visible(app, "Synthetic Duo history")
        visible(app, "기준일을 모름")
        visible(app, "직접 입력 · 미확인")

        tapDetails(app)
        tap(app, "manual-history-correct")
        guard replace(app, "manual-history-title-input", with: "Synthetic corrected Duo history") else { return }
        guard replace(app, "manual-history-details-input", with: "Synthetic corrected user-entered details.", multiline: true) else { return }
        guard replace(app, "manual-history-correction-note-input", with: "Kept the date unknown.") else { return }
        tap(app, "manual-history-save")

        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-correction-history")), app.debugDescription)
        visible(app, "Synthetic Duo history")
        visible(app, "Synthetic corrected Duo history")
        visible(app, "기준일을 모름")
        visible(app, "직접 입력 · 미확인")
        let selectedHistory = UITestConditions.element(app, "manual-history-selected-panel")
        XCTAssertTrue(UITestConditions.exists(selectedHistory), app.debugDescription)
        let portraitSize = app.frame.size

        XCUIDevice.shared.orientation = .landscapeLeft
        waitForOrientation(app, landscape: true, changedFrom: portraitSize)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-correction-history")), app.debugDescription)
        visible(app, "Synthetic corrected Duo history")
        assertPanelsDoNotOverlap(app)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-correct")), app.debugDescription)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-delete")), app.debugDescription)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-close-details")), app.debugDescription)

        let landscapeSize = app.frame.size
        XCUIDevice.shared.orientation = .portrait
        waitForOrientation(app, landscape: false, changedFrom: landscapeSize)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-detail")), app.debugDescription)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-correction-history")), app.debugDescription)
        assertPanelsDoNotOverlap(app)

        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        launch(app, largeText: true)
        try openManualHistory(app)
        tapDetails(app)
        visible(app, "Synthetic corrected Duo history")
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-correction-history")), app.debugDescription)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-delete")), app.debugDescription)
        assertPanelsStacked(app)
        tap(app, "manual-history-delete")
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-delete-confirmation")), app.debugDescription)
        tap(app, "manual-history-cancel-delete")
        visible(app, "Synthetic corrected Duo history")
    }

    @MainActor
    private func launch(_ app: XCUIApplication, largeText: Bool = false) {
        app.launchArguments = [
            "-OROT_TEST_PROFILE", "duo", "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ] + (largeText ? ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] : [])
        app.launch()
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
    }

    @MainActor
    private func openManualHistory(_ app: XCUIApplication) throws {
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "records-open-manual-history")
        NavigationUITestConditions.route(app, markers: ["manual-history-title"])
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "manual-history-scroll")), app.debugDescription)
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
    private func tap(_ app: XCUIApplication, _ identifier: String) {
        let target = UITestConditions.element(app, identifier)
        XCTAssertTrue(UITestConditions.exists(target), app.debugDescription)
        FormUITestConditions.reveal(target, in: app, scrollID: "manual-history-scroll")
        XCTAssertTrue(target.isHittable, app.debugDescription)
        target.tap()
    }

    @MainActor
    private func tapDetails(_ app: XCUIApplication) {
        let details = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "manual-history-details-")).firstMatch
        XCTAssertTrue(UITestConditions.exists(details), app.debugDescription)
        FormUITestConditions.reveal(details, in: app, scrollID: "manual-history-scroll")
        XCTAssertTrue(details.isHittable, app.debugDescription)
        details.tap()
    }

    @MainActor
    private func visible(_ app: XCUIApplication, _ label: String) {
        let text = app.staticTexts.matching(NSPredicate(format: "label == %@", label)).firstMatch
        XCTAssertTrue(UITestConditions.exists(text), app.debugDescription)
        FormUITestConditions.reveal(text, in: app, scrollID: "manual-history-scroll", towardTop: true)
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
    private func assertPanelsDoNotOverlap(_ app: XCUIApplication) {
        let list = UITestConditions.element(app, "manual-history-list-panel")
        let selected = UITestConditions.element(app, "manual-history-selected-panel")
        XCTAssertTrue(UITestConditions.exists(list) && UITestConditions.exists(selected), app.debugDescription)

        // Measured panel frames must form one readable row or one readable column after reflow.
        let sideBySide = selected.frame.minX >= list.frame.maxX - 1
        let stacked = selected.frame.minY >= list.frame.maxY - 1
            && abs(selected.frame.minX - list.frame.minX) < 2
        XCTAssertTrue(sideBySide || stacked, app.debugDescription)
    }

    @MainActor
    private func assertPanelsStacked(_ app: XCUIApplication) {
        let list = UITestConditions.element(app, "manual-history-list-panel")
        let selected = UITestConditions.element(app, "manual-history-selected-panel")
        XCTAssertTrue(UITestConditions.exists(list) && UITestConditions.exists(selected), app.debugDescription)
        XCTAssertGreaterThanOrEqual(selected.frame.minY, list.frame.maxY - 1, app.debugDescription)
        XCTAssertEqual(selected.frame.minX, list.frame.minX, accuracy: 2, app.debugDescription)
    }
}
