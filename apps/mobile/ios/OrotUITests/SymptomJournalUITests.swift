import XCTest

/// Types synthetic observations through the product UI and its real encrypted repository.
final class SymptomJournalUITests: OrotFailFastTestCase {
    @MainActor
    func testCreationEditingFilteringAndResolutionSurviveRelaunch() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        try launchJournal(app)
        tap(app, "symptom-add")
        replace(app, "symptom-description", "Synthetic intermittent tingling", multiline: true)
        replace(app, "symptom-onset-date", "2025-04-02")
        replace(app, "symptom-onset-time", "09:30")
        tap(app, "symptom-status-active")
        replace(app, "symptom-severity", "6")
        accessory(app, "symptom-keyboard-save-severity")
        visible(app, "Synthetic intermittent tingling")
        visible(app, "Your severity: 6/10")
        visible(app, "User-entered · not clinician-confirmed")
        let description = app.staticTexts.matching(NSPredicate(format:
            "identifier BEGINSWITH 'symptom-' AND identifier ENDSWITH '-description'")).firstMatch
        XCTAssertTrue(description.exists && description.isHittable)
        let cardID = String(description.identifier.dropLast("-description".count))
        // Remove only the card's wrapper; the stored entry ID retains its own symptom- prefix.
        let entryID = String(cardID.dropFirst("symptom-".count))
        let onset = UITestConditions.element(app, cardID + "-onset")
        XCTAssertTrue(onset.exists)
        let originalOnset = UITestConditions.text(onset)
        XCTAssertEqual(originalOnset, "2025-04-02 at 09:30 (local time)")
        tap(app, "symptom-edit-" + entryID)
        replace(app, "symptom-description", "Synthetic tingling after lunch\nUsually in the afternoon", multiline: true)
        accessory(app, "symptom-keyboard-save-description")
        UITestConditions.value(UITestConditions.element(app, cardID + "-description"),
                               equals: "Synthetic tingling after lunch\nUsually in the afternoon")
        UITestConditions.value(UITestConditions.element(app, cardID + "-onset"), equals: originalOnset)
        tap(app, "symptom-filter-active", towardTop: true)
        replace(app, "symptom-filter-from-date", "2025-04-02")
        replace(app, "symptom-filter-from-time", "09:30")
        replace(app, "symptom-filter-through-date", "2025-04-02")
        replace(app, "symptom-filter-through-time", "09:30")
        accessory(app, "symptom-filter-keyboard-apply-through-time")
        UITestConditions.value(UITestConditions.element(app, cardID + "-status"), equals: "Active")
        tap(app, "symptom-resolve-" + entryID)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "symptoms-empty")))
        tap(app, "symptom-filter-resolved", towardTop: true)
        UITestConditions.value(UITestConditions.element(app, cardID + "-status"), equals: "Resolved")
        UITestConditions.value(UITestConditions.element(app, cardID + "-onset"), equals: originalOnset)
        capture(app, "symptom-journal-resolved")
        app.terminate()
        try launchJournal(app)
        UITestConditions.value(UITestConditions.element(app, cardID + "-status"), equals: "Resolved")
        UITestConditions.value(UITestConditions.element(app, cardID + "-onset"), equals: originalOnset)
        visible(app, "User-entered · not clinician-confirmed")
        capture(app, "symptom-journal-persisted-after-relaunch")
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["records-title"])
    }

    @MainActor
    private func launchJournal(_ app: XCUIApplication) throws {
        // No provider, HealthKit, clock, or database adapter replaces the journal's product path.
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        let open = UITestConditions.element(app, "symptoms-open")
        XCTAssertTrue(UITestConditions.exists(open))
        FormUITestConditions.reveal(open, in: app, scrollID: "navigation-route-scroll")
        XCTAssertTrue(open.isHittable)
        open.tap()
        NavigationUITestConditions.route(app, markers: ["symptoms-title"])
        XCTAssertFalse(UITestConditions.element(app, "symptoms-back").exists)
    }

    @MainActor
    private func replace(_ app: XCUIApplication, _ identifier: String, _ value: String, multiline: Bool = false) {
        let input = multiline ? app.textViews[identifier] : app.textFields[identifier]
        XCTAssertTrue(UITestConditions.exists(input))
        FormUITestConditions.replace(input, with: value, in: app, scrollID: "symptoms-scroll")
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ identifier: String, towardTop: Bool = false) {
        let target = UITestConditions.element(app, identifier)
        XCTAssertTrue(UITestConditions.exists(target))
        FormUITestConditions.reveal(target, in: app, scrollID: "symptoms-scroll", towardTop: towardTop)
        XCTAssertTrue(target.isHittable)
        target.tap()
    }

    @MainActor
    private func accessory(_ app: XCUIApplication, _ identifier: String) {
        let button = UITestConditions.element(app, identifier)
        XCTAssertTrue(UITestConditions.exists(button) && button.isHittable)
        button.tap()
    }

    @MainActor
    private func visible(_ app: XCUIApplication, _ text: String) {
        let target = app.staticTexts.matching(NSPredicate(format: "label == %@", text)).firstMatch
        XCTAssertTrue(UITestConditions.exists(target))
        FormUITestConditions.reveal(target, in: app, scrollID: "symptoms-scroll", towardTop: true)
        XCTAssertTrue(target.isHittable)
    }

    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
