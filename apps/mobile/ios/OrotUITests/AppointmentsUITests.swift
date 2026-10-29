import XCTest

/// Uses the real manual form and encrypted repository; the fixture runner isolates each case before launch.
final class AppointmentsUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testCreationEditingAndCancellationSurviveProcessRestarts() throws {
        let app = XCUIApplication()
        defer {
            // Host latency is not a functional oracle; always terminate the owned app.
            app.terminate()
        }
        try launch(app)
        UITestConditions.value(UITestConditions.element(app, "appointments-empty"), equals: "등록된 예약이 없어요.")
        tap(app, "appointment-add")
        fill(app, clinic: "Cardiology clinic", date: "2027-06-02", time: "09:45", note: "Bring the test results.")
        visible(app, "Cardiology clinic")
        visible(app, "2027년 6월 2일 09:45 · 현지 시간")
        visible(app, "Bring the test results.")
        visible(app, "예정")
        XCTAssertTrue(app.buttons["Cardiology clinic 예약 취소"].exists)
        app.terminate()
        try launch(app)
        visible(app, "Cardiology clinic")
        visible(app, "2027년 6월 2일 09:45 · 현지 시간")
        visible(app, "Bring the test results.")

        let edit = app.buttons["수정"]
        XCTAssertTrue(edit.exists && edit.isHittable)
        edit.tap()
        fill(app, clinic: "Neurology clinic", date: "2027-06-03", time: "10:15", note: "")
        visible(app, "Neurology clinic")
        visible(app, "2027년 6월 3일 10:15 · 현지 시간")
        visible(app, "일정 변경")
        let cancel = app.buttons["Neurology clinic 예약 취소"]
        XCTAssertTrue(cancel.exists && cancel.isHittable)
        cancel.tap()
        visible(app, "취소됨")
        XCTAssertFalse(app.buttons["예약 취소"].exists)
        app.terminate()
        try launch(app)
        visible(app, "Neurology clinic")
        visible(app, "2027년 6월 3일 10:15 · 현지 시간")
        visible(app, "취소됨")
        try NavigationUITestConditions.tapNavigation(app, "appointments-back")
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
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
        try launch(app, extra: AppearanceUITestConditions.observationArguments)
        _ = try AppearanceUITestConditions.select(false, returningTo: app, testCase: self, captureOriginal: { originalAppearance = $0 })
        createAppointment(app, clinic: "Cardiology clinic", date: "2027-06-02", time: "09:45")
        createAppointment(app, clinic: "Neurology clinic", date: "2027-06-03", time: "10:15")

        let selection = UITestConditions.element(app, "appointment-select-manual-2")
        XCTAssertTrue(selection.waitForAppearance(), app.debugDescription)
        selection.tap()
        XCTAssertTrue(selection.isSelected, app.debugDescription)
        let clinic = UITestConditions.element(app, "appointment-clinic-manual-2")
        XCTAssertTrue(clinic.waitForAppearance(), app.debugDescription)
        XCTAssertEqual(UITestConditions.text(clinic), "Neurology clinic")

        let portraitBounds = app.frame
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForWindowBoundsChange(in: app, from: portraitBounds)
        let expandedUsesTwoColumns = try assertAppointmentPanelsFollowGeometry(app)
        XCTAssertTrue(expandedUsesTwoColumns, "Expanded Duo geometry should place the list and details side by side")
        XCTAssertTrue(selection.isSelected, app.debugDescription)
        XCTAssertEqual(UITestConditions.text(clinic), "Neurology clinic")
        _ = try AppearanceUITestConditions.select(true, returningTo: app, testCase: self)
        XCTAssertTrue(selection.isSelected, app.debugDescription)
        capture(app, "appointments-duo-dark-expanded-selection")

        let landscapeBounds = app.frame
        XCUIDevice.shared.orientation = .portrait
        waitForWindowBoundsChange(in: app, from: landscapeBounds)
        let compactUsesTwoColumns = try assertAppointmentPanelsFollowGeometry(app, expectsStacked: true)
        XCTAssertFalse(compactUsesTwoColumns)
        XCTAssertTrue(selection.isSelected, app.debugDescription)
        XCTAssertEqual(UITestConditions.text(clinic), "Neurology clinic")
        capture(app, "appointments-duo-light-compact-selection")
        tap(app, "appointment-edit-manual-2")
        ReminderJourneyForm.assertAppointmentForm(app, clinic: "Neurology clinic")
    }

    /// Confirms large text keeps details stacked and the appointment form reachable.
    @MainActor
    func testLargeTextKeepsAppointmentDetailsInOneReadableColumn() throws {
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        defer {
            app.terminate()
            XCUIDevice.shared.orientation = .portrait
        }
        try launch(app, largeText: true)
        createAppointment(app, clinic: "Cardiology clinic", date: "2027-06-02", time: "09:45")
        let selection = UITestConditions.element(app, "appointment-select-manual-1")
        XCTAssertTrue(selection.waitForAppearance(), app.debugDescription)
        XCTAssertTrue(selection.isSelected, app.debugDescription)

        let portraitBounds = app.frame
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForWindowBoundsChange(in: app, from: portraitBounds)
        let expandedUsesTwoColumns = try assertAppointmentPanelsFollowGeometry(app, expectsStacked: true)
        XCTAssertFalse(expandedUsesTwoColumns, "Large text must keep both panels in one readable column")
        XCTAssertTrue(selection.isSelected, app.debugDescription)
        XCTAssertEqual(
            UITestConditions.text(UITestConditions.element(app, "appointment-clinic-manual-1")),
            "Cardiology clinic",
        )
        let edit = UITestConditions.element(app, "appointment-edit-manual-1")
        FormUITestConditions.reveal(edit, in: app, scrollID: "appointments-scroll")
        XCTAssertTrue(edit.exists && edit.isHittable, app.debugDescription)
        capture(app, "appointments-large-text-details")
        edit.tap()
        ReminderJourneyForm.assertAppointmentForm(app, clinic: "Cardiology clinic")
    }

    @MainActor
    private func launch(_ app: XCUIApplication, largeText: Bool = false, extra: [String] = []) throws {
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-OROT_E2E_PROBE", "appointments", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + extra + (largeText ? ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] : [])
        app.launch()
        UITestConditions.value(UITestConditions.element(app, "appointments-title"), equals: "예약")
        let add = UITestConditions.element(app, "appointment-add")
        XCTAssertTrue(add.exists)
        if !largeText {
            XCTAssertTrue(add.isHittable)
        }
        let root = UITestConditions.element(app, "safe-area-root")
        let scroll = UITestConditions.element(app, "appointments-scroll")
        let title = UITestConditions.element(app, "appointments-title")
        for target in [root, scroll, title] {
            XCTAssertTrue(target.exists && !target.frame.isEmpty)
        }
        XCTAssertGreaterThanOrEqual(scroll.frame.minY - root.frame.minY, 44)
        XCTAssertGreaterThanOrEqual(title.frame.minY - root.frame.minY, 44)
        let action = try NavigationUITestConditions.navigationAction(app, "appointments-back")
        XCTAssertGreaterThanOrEqual(action.control.frame.minY, action.toolbar.frame.minY)
        XCTAssertLessThanOrEqual(action.control.frame.maxY, action.toolbar.frame.maxY)
        XCTAssertFalse(UITestConditions.element(app, "appointments-top-back").exists)
        capture(app, "manual-appointments-bottom-back-safe-area")
    }

    @MainActor
    private func createAppointment(_ app: XCUIApplication, clinic: String, date: String, time: String) {
        tap(app, "appointment-add")
        fill(app, clinic: clinic, date: date, time: time, note: "")
        visible(app, clinic)
    }

    @MainActor
    private func assertAppointmentPanelsFollowGeometry(_ app: XCUIApplication, expectsStacked: Bool? = nil) throws -> Bool {
        let primary = UITestConditions.element(app, "appointments-columns-primary")
        let secondary = UITestConditions.element(app, "appointments-columns-secondary")
        XCTAssertTrue(primary.exists && !primary.frame.isEmpty, app.debugDescription)
        XCTAssertTrue(secondary.exists && !secondary.frame.isEmpty, app.debugDescription)
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
    private func waitForWindowBoundsChange(in app: XCUIApplication, from previous: CGRect) {
        var current = CGRect.zero
        let boundsChanged = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                current = app.frame
                return abs(current.width - previous.width) > 0.5 ||
                    abs(current.height - previous.height) > 0.5
            },
            object: nil,
        )
        XCTAssertEqual(
            UITestConditions.wait(for: [boundsChanged]),
            .completed,
            "Appointments must observe the device's updated UIKit bounds.",
        )
    }

    @MainActor
    private func fill(_ app: XCUIApplication, clinic: String, date: String, time: String, note: String) {
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
    private func tap(_ app: XCUIApplication, _ identifier: String) {
        let target = UITestConditions.element(app, identifier)
        XCTAssertTrue(UITestConditions.exists(target))
        FormUITestConditions.reveal(target, in: app, scrollID: "appointments-scroll")
        target.tap()
    }

    @MainActor
    private func visible(_ app: XCUIApplication, _ text: String) {
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
