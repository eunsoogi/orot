import XCTest

/// Keeps the next-visit journey readable while preserving its existing XCTest class and selector.
extension AppointmentsUITests {
    /// Confirms reopened management selects the same eligible visit marked by its badge.
    @MainActor
    func testOpeningAppointmentsSelectsTheVisitMarkedAsNext() throws {
        let app = XCUIApplication()
        let calendar = Calendar.current
        let today = Date()
        let pastVisit = try XCTUnwrap(calendar.date(byAdding: .day, value: -2, to: today))
        let firstVisit = try XCTUnwrap(calendar.date(byAdding: .day, value: 2, to: today))
        let nextVisit = try XCTUnwrap(calendar.date(byAdding: .day, value: 3, to: today))
        let laterVisit = try XCTUnwrap(calendar.date(byAdding: .day, value: 4, to: today))
        let addedVisit = try XCTUnwrap(calendar.date(byAdding: .day, value: 5, to: today))
        let dateFormatter = DateFormatter()
        dateFormatter.calendar = calendar
        dateFormatter.locale = Locale(identifier: "en_US_POSIX")
        dateFormatter.timeZone = calendar.timeZone
        dateFormatter.dateFormat = "yyyy-MM-dd"
        defer { app.terminate() }
        let rowsForClinic = { (clinic: String) in
            app.buttons.matching(
                NSPredicate(
                    format: "identifier BEGINSWITH %@ AND label CONTAINS %@",
                    "appointment-select-",
                    clinic,
                ),
            )
        }

        try launch(app)
        tap(app, "appointment-add")
        // Relative local dates keep this regression future-dated in later test runs.
        fill(
            app,
            clinic: "Cancelled visit",
            date: dateFormatter.string(from: firstVisit),
            time: "09:00",
            note: "",
        )
        visible(app, "Cancelled visit")
        let cancelledRows = rowsForClinic("Cancelled visit")
        XCTAssertEqual(cancelledRows.count, 1, app.debugDescription)
        let cancelledSelection = cancelledRows.element(boundBy: 0)
        XCTAssertTrue(cancelledSelection.waitForAppearance(), app.debugDescription)
        let selectionPrefix = "appointment-select-"
        let selectionIdentifier = cancelledSelection.identifier
        XCTAssertTrue(selectionIdentifier.hasPrefix(selectionPrefix), app.debugDescription)
        XCTAssertTrue(cancelledSelection.label.contains("Cancelled visit"), app.debugDescription)
        XCTAssertTrue(cancelledSelection.isSelected, app.debugDescription)
        XCTAssertTrue(cancelledSelection.label.contains("다음 진료"), app.debugDescription)

        // Native appointment IDs are opaque; pair this exact clinic row with its cancel action.
        let appointmentID = String(selectionIdentifier.dropFirst(selectionPrefix.count))
        let cancellationButtons = app.buttons.matching(
            identifier: "appointment-cancel-\(appointmentID)",
        )
        XCTAssertEqual(cancellationButtons.count, 1, app.debugDescription)
        let cancellationButton = cancellationButtons.element(boundBy: 0)
        FormUITestConditions.reveal(
            cancellationButton,
            in: app,
            scrollID: "appointments-scroll",
        )
        XCTAssertTrue(cancellationButton.exists && cancellationButton.isHittable, app.debugDescription)
        cancellationButton.tap()
        XCTAssertFalse(cancelledSelection.isSelected, app.debugDescription)
        XCTAssertTrue(cancelledSelection.label.contains("취소됨"), app.debugDescription)
        XCTAssertFalse(cancelledSelection.label.contains("다음 진료"), app.debugDescription)

        tap(app, "appointment-add")
        fill(
            app,
            clinic: "Past visit",
            date: dateFormatter.string(from: pastVisit),
            time: "09:00",
            note: "",
        )
        visible(app, "Past visit")

        tap(app, "appointment-add")
        fill(
            app,
            clinic: "Next visit",
            date: dateFormatter.string(from: nextVisit),
            time: "09:00",
            note: "",
        )
        visible(app, "Next visit")
        tap(app, "appointment-add")
        fill(
            app,
            clinic: "Later visit",
            date: dateFormatter.string(from: laterVisit),
            time: "09:00",
            note: "",
        )
        visible(app, "Later visit")

        app.terminate()
        try launch(app)

        let cancelledMatches = rowsForClinic("Cancelled visit")
        let pastMatches = rowsForClinic("Past visit")
        let nextMatches = rowsForClinic("Next visit")
        let laterMatches = rowsForClinic("Later visit")
        XCTAssertEqual(cancelledMatches.count, 1, app.debugDescription)
        XCTAssertEqual(pastMatches.count, 1, app.debugDescription)
        XCTAssertEqual(nextMatches.count, 1, app.debugDescription)
        XCTAssertEqual(laterMatches.count, 1, app.debugDescription)
        let cancelled = cancelledMatches.element(boundBy: 0)
        let past = pastMatches.element(boundBy: 0)
        let next = nextMatches.element(boundBy: 0)
        let later = laterMatches.element(boundBy: 0)
        XCTAssertTrue(cancelled.waitForAppearance(), app.debugDescription)
        XCTAssertTrue(past.waitForAppearance(), app.debugDescription)
        XCTAssertTrue(next.waitForAppearance(), app.debugDescription)
        XCTAssertTrue(later.waitForAppearance(), app.debugDescription)
        XCTAssertFalse(cancelled.isSelected, app.debugDescription)
        XCTAssertFalse(past.isSelected, app.debugDescription)
        XCTAssertTrue(next.isSelected, app.debugDescription)
        XCTAssertFalse(later.isSelected, app.debugDescription)
        XCTAssertTrue(next.label.contains("다음 진료"), app.debugDescription)
        XCTAssertFalse(cancelled.label.contains("다음 진료"), app.debugDescription)

        FormUITestConditions.reveal(past, in: app, scrollID: "appointments-scroll")
        XCTAssertTrue(past.exists && past.isHittable, app.debugDescription)
        past.tap()
        XCTAssertTrue(past.isSelected, app.debugDescription)
        XCTAssertFalse(next.isSelected, app.debugDescription)
        XCTAssertTrue(next.label.contains("다음 진료"), app.debugDescription)

        tap(app, "appointment-add")
        fill(
            app,
            clinic: "Added visit",
            date: dateFormatter.string(from: addedVisit),
            time: "09:00",
            note: "",
        )
        visible(app, "Added visit")
        XCTAssertTrue(past.exists && past.isSelected, app.debugDescription)
        XCTAssertTrue(next.label.contains("다음 진료"), app.debugDescription)
    }

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
