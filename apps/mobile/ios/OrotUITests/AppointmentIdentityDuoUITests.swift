import XCTest

extension AppointmentsUITests {
    /// Binds each displayed clinic to the repository identity after its save succeeds.
    @MainActor
    func createAppointment(_ app: XCUIApplication, clinic: String, date: String, time: String, previous: String = "") -> String {
        tap(app, "appointment-add")
        fill(app, clinic: clinic, date: date, time: time, note: "")
        let identity = UITestConditions.appointmentIdentity(app, previous: previous)
        let selection = UITestConditions.element(app, "appointment-select-\(identity)")
        if !selection.isSelected {
            tap(app, "appointment-select-\(identity)")
        }
        XCTAssertTrue(selection.isSelected)
        let clinics = app.staticTexts.matching(identifier: "appointment-clinic-\(identity)")
        let savedClinic = clinics.firstMatch
        XCTAssertTrue(savedClinic.waitForAppearance())
        XCTAssertEqual(clinics.count, 1)
        FormUITestConditions.reveal(savedClinic, in: app, scrollID: "appointments-scroll", towardTop: true)
        XCTAssertTrue(savedClinic.isHittable)
        XCTAssertEqual(UITestConditions.text(savedClinic), clinic)
        return identity
    }

    /// Verifies the saved second identity and continuous page without requiring a posture change.
    @MainActor
    func testSavedAppointmentIdentitySurvivesAppearanceEditAndRestart() throws {
        let app = XCUIApplication()
        var originalAppearance: AppearanceUITestConditions.Snapshot?
        defer {
            if let originalAppearance {
                do { try AppearanceUITestConditions.restore(originalAppearance, returningTo: app, testCase: self) }
                catch { XCTFail("Could not restore the owned Simulator's appearance: \(error)") }
            }
            app.terminate()
        }
        try launch(app, extra: AppearanceUITestConditions.observationArguments)
        _ = try AppearanceUITestConditions.select(false, returningTo: app, testCase: self, captureOriginal: { originalAppearance = $0 })
        let first = createAppointment(app, clinic: "Cardiology clinic", date: "2027-06-02", time: "09:45")
        let second = createAppointment(app, clinic: "Neurology clinic", date: "2027-06-03", time: "10:15", previous: first)
        XCTAssertNotEqual(first, second)
        let selection = UITestConditions.element(app, "appointment-select-\(second)")
        XCTAssertTrue(selection.waitForAppearance())
        selection.tap()
        XCTAssertTrue(selection.isSelected)
        let clinic = UITestConditions.element(app, "appointment-clinic-\(second)")
        XCTAssertTrue(clinic.waitForAppearance())
        XCTAssertEqual(UITestConditions.text(clinic), "Neurology clinic")
        XCTAssertFalse(try assertAppointmentPanelsFollowGeometry(app, expectsStacked: true))
        let edit = UITestConditions.element(app, "appointment-edit-\(second)")
        FormUITestConditions.reveal(edit, in: app, scrollID: "appointments-scroll")
        XCTAssertTrue(edit.exists && edit.isHittable)
        XCTAssertGreaterThanOrEqual(edit.frame.width, 44)
        XCTAssertGreaterThanOrEqual(edit.frame.height, 44)
        _ = try AppearanceUITestConditions.select(true, returningTo: app, testCase: self)
        XCTAssertTrue(selection.isSelected)
        tap(app, "appointment-edit-\(second)")
        ReminderJourneyForm.assertAppointmentForm(app, clinic: "Neurology clinic")
        app.terminate()
        try launch(app, extra: AppearanceUITestConditions.observationArguments)
        let restored = UITestConditions.element(app, "appointment-select-\(second)")
        XCTAssertTrue(restored.waitForAppearance())
        restored.tap()
        XCTAssertTrue(restored.isSelected)
        XCTAssertEqual(UITestConditions.text(UITestConditions.element(app, "appointment-clinic-\(second)")), "Neurology clinic")
    }
}
