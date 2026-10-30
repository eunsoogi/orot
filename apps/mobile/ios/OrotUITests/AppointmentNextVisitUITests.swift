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
        visible(app, "취소됨")
        XCTAssertFalse(app.buttons["예약 취소"].exists)
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
        // Empty Home shows capture guidance in place of the next-visit panel.
        NavigationUITestConditions.route(app, markers: ["home-capture-guidance"])
        // A cancelled appointment must not remain Home's next visit.
        let remainingHomeClinicMatches = app.staticTexts.matching(
            identifier: "home-next-appointment-clinic",
        )
        XCTAssertEqual(remainingHomeClinicMatches.count, 0, app.debugDescription)
    }
}
