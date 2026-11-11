import XCTest

/// Keeps the next-visit journey readable while preserving its existing XCTest class and selector.
extension AppointmentsUITests {
    @MainActor
    func testCreationEditingAndCancellationSurviveProcessRestarts() throws {
        let app = XCUIApplication()
        let initialClinic = "Cardiology clinic"
        let updatedClinic = "Neurology clinic"
        defer {
            // Host latency is not a functional oracle; always terminate the owned app.
            app.terminate()
        }
        try launch(app)
        UITestConditions.value(UITestConditions.element(app, "appointments-empty"), equals: "등록된 예약이 없어요.")
        tap(app, "appointment-add")
        fill(app, clinic: initialClinic, date: "2027-06-02", time: "09:45", note: "Bring the test results.")
        // The row label carries next-visit meaning; its badge is not a separate native element.
        // Native storage generates opaque IDs, so find this synthetic row by clinic and capture its actual identifier.
        let appointmentCandidates = app.buttons.matching(
            NSPredicate(
                format: "identifier BEGINSWITH %@ AND label CONTAINS %@",
                "appointment-select-",
                initialClinic,
            ),
        )
        let firstAppointmentRow = appointmentCandidates.firstMatch
        XCTAssertTrue(firstAppointmentRow.waitForAppearance(), app.debugDescription)
        XCTAssertEqual(appointmentCandidates.count, 1, app.debugDescription)
        let appointmentRowIdentifier = firstAppointmentRow.identifier
        XCTAssertTrue(appointmentRowIdentifier.hasPrefix("appointment-select-"), app.debugDescription)
        let appointmentRow = app.buttons.matching(identifier: appointmentRowIdentifier).firstMatch
        XCTAssertTrue(appointmentRow.exists && appointmentRow.isHittable, app.debugDescription)
        XCTAssertTrue(appointmentRow.label.contains("다음 진료"), app.debugDescription)
        try NavigationUITestConditions.tapNavigation(app, "appointments-back")
        NavigationUITestConditions.route(app, markers: ["home-next-appointment"])
        let homeClinicMatches = app.staticTexts.matching(identifier: "home-next-appointment-clinic")
        let homeClinicMatchCount = homeClinicMatches.count
        let homeClinic = homeClinicMatchCount == 1 ? homeClinicMatches.element(boundBy: 0) : nil
        let homeClinicExists = homeClinic?.exists ?? false
        let homeClinicIsHittable = homeClinicExists && (homeClinic?.isHittable ?? false)
        let homeClinicLabel = homeClinic?.label

        // Capture both Home queries before assertions because this journey stops at its first failure.
        let recordLabelOnlyQuery = {
            let labelOnlyClinic = app.staticTexts[initialClinic]
            let labelOnlyExists = labelOnlyClinic.exists
            let labelOnlyIsHittable = labelOnlyExists && labelOnlyClinic.isHittable
            XCTContext.runActivity(
                named: "Prior Home clinic label query, diagnostic only: exists=\(labelOnlyExists), isHittable=\(labelOnlyIsHittable)",
            ) { _ in }
        }
        recordLabelOnlyQuery()

        XCTAssertEqual(homeClinicMatchCount, 1, app.debugDescription)
        // The later Home assertions need one identified clinic element and its label.
        guard homeClinic != nil, let homeClinicLabel else { return }
        XCTAssertEqual(homeClinicLabel, initialClinic, app.debugDescription)
        XCTAssertTrue(homeClinicExists && homeClinicIsHittable, app.debugDescription)
        app.terminate()
        try launch(app)
        visible(app, initialClinic)
        visible(app, "2027년 6월 2일 09:45 · 현지 시간")
        visible(app, "Bring the test results.")
        XCTAssertTrue(appointmentRow.exists && appointmentRow.isHittable, app.debugDescription)
        XCTAssertTrue(appointmentRow.label.contains(initialClinic), app.debugDescription)
        XCTAssertTrue(appointmentRow.label.contains("다음 진료"), app.debugDescription)

        let appointmentID = String(appointmentRowIdentifier.dropFirst("appointment-select-".count))
        let reminderRow = UITestConditions.element(app, "appointment-reminder-actions")
        let oneHourReminder = UITestConditions.element(app, "appointment-reminder-\(appointmentID)-60")
        let oneDayReminder = UITestConditions.element(app, "appointment-reminder-\(appointmentID)-1440")
        let cancelAction = UITestConditions.element(app, "appointment-cancel-\(appointmentID)")
        let headerEdit = UITestConditions.element(app, "appointment-edit-\(appointmentID)")
        let header = UITestConditions.element(app, "appointment-header-\(appointmentID)")
        XCTAssertTrue(reminderRow.exists && !reminderRow.frame.isEmpty, app.debugDescription)
        XCTAssertTrue(header.exists && header.frame.contains(headerEdit.frame), app.debugDescription)
        // Standard text keeps equal-height detail actions on one native row with full touch targets.
        for action in [oneHourReminder, oneDayReminder, cancelAction] {
            XCTAssertTrue(action.exists && action.isHittable, app.debugDescription)
            XCTAssertGreaterThanOrEqual(action.frame.width, 44, app.debugDescription)
            XCTAssertGreaterThanOrEqual(action.frame.height, 44, app.debugDescription)
        }
        XCTAssertEqual(oneHourReminder.frame.width, oneDayReminder.frame.width, accuracy: 1, app.debugDescription)
        XCTAssertEqual(oneDayReminder.frame.width, cancelAction.frame.width, accuracy: 1, app.debugDescription)
        XCTAssertEqual(oneHourReminder.frame.height, oneDayReminder.frame.height, accuracy: 1, app.debugDescription)
        XCTAssertEqual(oneDayReminder.frame.height, cancelAction.frame.height, accuracy: 1, app.debugDescription)
        XCTAssertEqual(oneHourReminder.frame.midY, oneDayReminder.frame.midY, accuracy: 1, app.debugDescription)
        XCTAssertEqual(oneDayReminder.frame.midY, cancelAction.frame.midY, accuracy: 1, app.debugDescription)
        XCTAssertLessThanOrEqual(oneHourReminder.frame.maxX, oneDayReminder.frame.minX + 1, app.debugDescription)
        XCTAssertLessThanOrEqual(oneDayReminder.frame.maxX, cancelAction.frame.minX + 1, app.debugDescription)

        let edit = app.buttons["수정"]
        XCTAssertTrue(edit.exists && edit.isHittable)
        edit.tap()
        fill(app, clinic: updatedClinic, date: "2027-06-03", time: "10:15", note: "")
        visible(app, updatedClinic)
        visible(app, "2027년 6월 3일 10:15 · 현지 시간")
        visible(app, "일정 변경")
        let cancel = app.buttons["\(updatedClinic) 예약 취소"]
        XCTAssertTrue(cancel.exists && cancel.isHittable)
        cancel.tap()
        let confirmation = app.alerts.firstMatch
        XCTAssertTrue(confirmation.waitForAppearance(), app.debugDescription)
        let keepAppointment = confirmation.buttons["예약 유지"]
        let confirmCancellation = confirmation.buttons["예약 취소"]
        XCTAssertTrue(keepAppointment.exists && keepAppointment.isHittable, app.debugDescription)
        XCTAssertTrue(confirmCancellation.exists && confirmCancellation.isHittable, app.debugDescription)
        // Dismissing the alert must leave this appointment eligible as the next visit.
        keepAppointment.tap()
        XCTAssertFalse(confirmation.exists, app.debugDescription)
        XCTAssertTrue(appointmentRow.label.contains("다음 진료"), app.debugDescription)
        cancel.tap()
        let confirmationAfterKeep = app.alerts.firstMatch
        XCTAssertTrue(confirmationAfterKeep.waitForAppearance(), app.debugDescription)
        let confirmedCancel = confirmationAfterKeep.buttons["예약 취소"]
        XCTAssertTrue(confirmedCancel.exists && confirmedCancel.isHittable, app.debugDescription)
        confirmedCancel.tap()
        visible(app, "취소됨")
        XCTAssertFalse(cancel.exists, app.debugDescription)
        let cancelledRowLabel = appointmentRow.label
        XCTAssertTrue(cancelledRowLabel.contains("취소됨"), app.debugDescription)
        XCTAssertFalse(cancelledRowLabel.contains("다음 진료"), app.debugDescription)
        app.terminate()
        try launch(app)
        visible(app, updatedClinic)
        visible(app, "2027년 6월 3일 10:15 · 현지 시간")
        visible(app, "취소됨")
        XCTAssertTrue(appointmentRow.exists && appointmentRow.isHittable, app.debugDescription)
        let restartedRowLabel = appointmentRow.label
        XCTAssertTrue(restartedRowLabel.contains(updatedClinic), app.debugDescription)
        XCTAssertTrue(restartedRowLabel.contains("취소됨"), app.debugDescription)
        XCTAssertFalse(restartedRowLabel.contains("다음 진료"), app.debugDescription)
        try NavigationUITestConditions.tapNavigation(app, "appointments-back")
        // Empty Home retains an appointment action without claiming an eligible visit.
        NavigationUITestConditions.route(app, markers: ["home-open-schedule"])
        // A cancelled appointment must not remain Home's next visit.
        let remainingHomeClinicMatches = app.staticTexts.matching(
            identifier: "home-next-appointment-clinic",
        )
        XCTAssertEqual(remainingHomeClinicMatches.count, 0, app.debugDescription)
    }
}
