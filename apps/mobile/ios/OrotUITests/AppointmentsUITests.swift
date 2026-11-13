import XCTest

/// Owns native appointment selection and responsive-layout coverage.
final class AppointmentsUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// Keeps selected details and the form through native size and appearance changes.
    @MainActor
    func testAppointmentSelectionDetailsReflowAcrossDuoGeometry() throws {
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        var originalAppearance: AppearanceUITestConditions.Snapshot?
        defer {
            if let originalAppearance {
                do {
                    try AppearanceUITestConditions.restore(originalAppearance, returningTo: app, testCase: self)
                } catch {
                    XCTFail("Could not restore the owned Simulator's appearance: \(error)")
                }
            }
            app.terminate()
            XCUIDevice.shared.orientation = .portrait
        }
        let rotationSession = UUID().uuidString
        try launch(app, extra: AppearanceUITestConditions.observationArguments + ["-OROT_TEST_ROTATION_GEOMETRY_SESSION", rotationSession])
        _ = try AppearanceUITestConditions.select(false, returningTo: app, testCase: self, captureOriginal: { originalAppearance = $0 })
        let firstIdentity = createAppointment(app, clinic: "Cardiology clinic", date: "2027-06-02", time: "09:45")
        let identity = createAppointment(app, clinic: "Neurology clinic", date: "2027-06-03", time: "10:15", previous: firstIdentity)
        XCTAssertNotEqual(firstIdentity, identity)

        let selection = UITestConditions.element(app, "appointment-select-\(identity)")
        XCTAssertTrue(selection.waitForAppearance(), app.debugDescription)
        selection.tap()
        XCTAssertTrue(selection.isSelected, app.debugDescription)
        let clinic = UITestConditions.element(app, "appointment-clinic-\(identity)")
        XCTAssertTrue(clinic.waitForAppearance(), app.debugDescription)
        XCTAssertEqual(UITestConditions.text(clinic), "Neurology clinic")

        try UITestConditions.rotateAppointmentScene(app, session: rotationSession, landscape: true)
        let expandedUsesTwoColumns = try assertAppointmentPanelsFollowGeometry(app, expectsStacked: true)
        XCTAssertFalse(expandedUsesTwoColumns, "The appointment page keeps one vertical reading flow")
        let edit = UITestConditions.element(app, "appointment-edit-\(identity)")
        FormUITestConditions.reveal(edit, in: app, scrollID: "appointments-scroll")
        XCTAssertTrue(edit.exists && edit.isHittable, app.debugDescription)
        XCTAssertGreaterThanOrEqual(edit.frame.width, 44)
        XCTAssertGreaterThanOrEqual(edit.frame.height, 44)
        XCTAssertTrue(selection.isSelected, app.debugDescription)
        XCTAssertEqual(UITestConditions.text(clinic), "Neurology clinic")
        _ = try AppearanceUITestConditions.select(true, returningTo: app, testCase: self)
        XCTAssertTrue(selection.isSelected, app.debugDescription)
        capture(app, "appointments-duo-dark-expanded-selection")

        try UITestConditions.rotateAppointmentScene(app, session: rotationSession, landscape: false)
        let compactUsesTwoColumns = try assertAppointmentPanelsFollowGeometry(app, expectsStacked: true)
        XCTAssertFalse(compactUsesTwoColumns)
        XCTAssertTrue(selection.isSelected, app.debugDescription)
        XCTAssertEqual(UITestConditions.text(clinic), "Neurology clinic")
        capture(app, "appointments-duo-light-compact-selection")
        tap(app, "appointment-edit-\(identity)")
        ReminderJourneyForm.assertAppointmentForm(app, clinic: "Neurology clinic")
    }

    /// Confirms large text keeps details readable and each native action reachable.
    @MainActor
    func testLargeTextKeepsAppointmentDetailsInOneReadableColumn() throws {
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        defer {
            app.terminate()
            XCUIDevice.shared.orientation = .portrait
        }
        try launch(app, largeText: true)
        let longClinic = "Cardiology and Neurology appointment center"
        let identity = createAppointment(app, clinic: longClinic, date: "2027-06-02", time: "09:45")
        let selection = UITestConditions.element(app, "appointment-select-\(identity)")
        XCTAssertTrue(selection.waitForAppearance(), app.debugDescription)
        XCTAssertTrue(selection.isSelected, app.debugDescription)

        let actionStack = UITestConditions.element(app, "appointment-actions-\(identity)")
        let oneHourReminder = UITestConditions.element(app, "appointment-reminder-\(identity)-60")
        let oneDayReminder = UITestConditions.element(app, "appointment-reminder-\(identity)-1440")
        let edit = UITestConditions.element(app, "appointment-edit-\(identity)")
        let cancel = UITestConditions.element(app, "appointment-cancel-\(identity)")
        let reminderRow = UITestConditions.element(app, "appointment-reminder-actions")
        // Portrait at accessibility text size covers narrow-width native reachability.
        for action in [oneHourReminder, oneDayReminder, edit, cancel] {
            FormUITestConditions.reveal(action, in: app, scrollID: "appointments-scroll")
            XCTAssertTrue(action.exists && action.isHittable, app.debugDescription)
            XCTAssertGreaterThanOrEqual(action.frame.width, 44, app.debugDescription)
            XCTAssertGreaterThanOrEqual(action.frame.height, 44, app.debugDescription)
        }
        XCTAssertTrue(actionStack.exists && !actionStack.frame.isEmpty, app.debugDescription)
        XCTAssertTrue(reminderRow.exists && !reminderRow.frame.isEmpty, app.debugDescription)
        XCTAssertLessThan(edit.frame.width, actionStack.frame.width, app.debugDescription)
        for action in [oneHourReminder, oneDayReminder, cancel] {
            XCTAssertGreaterThanOrEqual(action.frame.minX, actionStack.frame.minX - 1, app.debugDescription)
            XCTAssertLessThanOrEqual(action.frame.maxX, actionStack.frame.maxX + 1, app.debugDescription)
        }
        XCTAssertTrue(cancel.label.contains(longClinic), app.debugDescription)
        let reminderFrames = [oneHourReminder.frame, oneDayReminder.frame, cancel.frame]
        for firstIndex in reminderFrames.indices {
            for secondIndex in reminderFrames.indices where secondIndex > firstIndex {
                XCTAssertFalse(
                    reminderFrames[firstIndex].intersects(reminderFrames[secondIndex]),
                    app.debugDescription,
                )
            }
        }
        let allActionsShareOneRow =
            abs(oneHourReminder.frame.midY - oneDayReminder.frame.midY) <= 1 &&
            abs(oneDayReminder.frame.midY - cancel.frame.midY) <= 1
        XCTAssertFalse(allActionsShareOneRow, "Accessibility text should wrap action cells without shrinking targets")

        cancel.tap()
        let confirmation = app.alerts.firstMatch
        XCTAssertTrue(confirmation.waitForAppearance(), app.debugDescription)
        let keepAppointment = confirmation.buttons["예약 유지"]
        XCTAssertTrue(keepAppointment.exists && keepAppointment.isHittable, app.debugDescription)
        keepAppointment.tap()
        XCTAssertFalse(confirmation.exists, app.debugDescription)

        let portraitBounds = app.windows.firstMatch.frame
        XCUIDevice.shared.orientation = .landscapeLeft
        UITestConditions.waitForWindowBoundsChange(in: app, from: portraitBounds)
        let expandedUsesTwoColumns = try assertAppointmentPanelsFollowGeometry(app, expectsStacked: true)
        XCTAssertFalse(expandedUsesTwoColumns, "Large text must keep both panels in one readable column")
        XCTAssertTrue(selection.isSelected, app.debugDescription)
        XCTAssertEqual(
            UITestConditions.text(UITestConditions.element(app, "appointment-clinic-\(identity)")),
            longClinic,
        )
        FormUITestConditions.reveal(edit, in: app, scrollID: "appointments-scroll")
        capture(app, "appointments-large-text-details")
        edit.tap()
        ReminderJourneyForm.assertAppointmentForm(app, clinic: longClinic)
    }

    @MainActor
    func launch(_ app: XCUIApplication, largeText: Bool = false, extra: [String] = []) throws {
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-OROT_E2E_PROBE", "appointments", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES", "-OROT_TEST_NAVIGATION_FOCUS_OBSERVATION", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + extra + (largeText ? ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] : [])
        let launchedAt = Date().timeIntervalSince1970 * 1000
        app.launch()
        UITestConditions.value(UITestConditions.element(app, "appointments-title"), equals: "예약")
        let add = UITestConditions.element(app, "appointment-add")
        XCTAssertTrue(add.exists)
        let root = UITestConditions.element(app, "safe-area-root")
        let scroll = UITestConditions.element(app, "appointments-scroll")
        let title = UITestConditions.element(app, "appointments-title")
        for target in [root, scroll, title] {
            XCTAssertTrue(target.exists && !target.frame.isEmpty)
        }
        ViewportObservation.captureIfEnabled(app, entry: "appointments-probe", stage: "before-scroll-44pt-guard", testCase: self)
        let action = try NavigationUITestConditions.navigationAction(app, "appointments-back")
        let safeFrame = try ViewportObservation.verifyAppointmentViewport(app, scroll: scroll, title: title, action: action, launchedAt: launchedAt, testCase: self)
        try verifyAppointmentAdd(app, add: add, scroll: scroll, safeFrame: safeFrame, toolbar: action.toolbar.frame)
        XCTAssertGreaterThanOrEqual(action.control.frame.minY, action.toolbar.frame.minY)
        XCTAssertLessThanOrEqual(action.control.frame.maxY, action.toolbar.frame.maxY)
        XCTAssertFalse(UITestConditions.element(app, "appointments-top-back").exists)
        capture(app, "manual-appointments-bottom-back-safe-area")
    }

    @MainActor
    func assertAppointmentPanelsFollowGeometry(_ app: XCUIApplication, expectsStacked: Bool? = nil) throws -> Bool {
        let primary = UITestConditions.element(app, "appointments-columns-primary")
        let secondary = UITestConditions.element(app, "appointments-columns-secondary")
        XCTAssertTrue(primary.exists && !primary.frame.isEmpty, app.debugDescription)
        XCTAssertTrue(secondary.exists && !secondary.frame.isEmpty, app.debugDescription)
        let scroll = app.scrollViews.matching(identifier: "appointments-scroll").firstMatch
        XCTAssertTrue(scroll.exists && !scroll.frame.isEmpty, app.debugDescription)
        XCTAssertEqual(scroll.descendants(matching: .scrollView).count, 0, "Appointment sections must not introduce nested scroll owners")
        XCTAssertEqual(scroll.descendants(matching: .any).matching(identifier: "appointments-columns-primary").count, 1)
        XCTAssertEqual(scroll.descendants(matching: .any).matching(identifier: "appointments-columns-secondary").count, 1)
        let primaryFrame = primary.frame
        let secondaryFrame = secondary.frame
        let sideBySide = abs(primaryFrame.minY - secondaryFrame.minY) <= 1 &&
            primaryFrame.maxX <= secondaryFrame.minX + 1
        let stacked = abs(primaryFrame.minX - secondaryFrame.minX) <= 1 &&
            primaryFrame.maxY <= secondaryFrame.minY + 1
        XCTAssertTrue(
            sideBySide || stacked,
            "Appointment panels must follow one readable measured column or two non-overlapping columns: primary=\(primaryFrame), secondary=\(secondaryFrame)",
        )
        if expectsStacked == true {
            XCTAssertTrue(stacked, "The active geometry must keep appointment details below the list")
        }
        let navigation = try NavigationUITestConditions.navigationAction(app, "appointments-back")
        if navigation.toolbar.frame.height > navigation.toolbar.frame.width {
            XCTAssertLessThanOrEqual(max(primaryFrame.maxX, secondaryFrame.maxX), navigation.toolbar.frame.minX + 1)
        }
        return sideBySide
    }

    @MainActor
    func fill(_ app: XCUIApplication, clinic: String, date: String, time: String, note: String) {
        for (field, value) in [("clinic", clinic), ("date", date), ("time", time), ("note", note)] {
            let input = app.textFields.matching(identifier: "appointment-\(field)-input").firstMatch
            XCTAssertTrue(UITestConditions.exists(input))
            FormUITestConditions.replace(input, with: value, in: app, scrollID: "appointments-scroll", useNativeSelectAllMenu: true)
        }
        capture(app, "appointment-editor-keyboard")
        app.textFields.matching(identifier: "appointment-note-input").firstMatch.typeText("\n")
        tap(app, "appointment-save")
    }

    @MainActor
    func tap(_ app: XCUIApplication, _ identifier: String) {
        let target = UITestConditions.element(app, identifier)
        XCTAssertTrue(UITestConditions.exists(target))
        FormUITestConditions.reveal(target, in: app, scrollID: "appointments-scroll")
        target.tap()
    }

    @MainActor
    func visible(_ app: XCUIApplication, _ text: String) {
        let target = app.staticTexts.matching(NSPredicate(format: "label == %@", text)).firstMatch
        XCTAssertTrue(UITestConditions.exists(target), app.debugDescription)
        FormUITestConditions.reveal(target, in: app, scrollID: "appointments-scroll", towardTop: true)
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
