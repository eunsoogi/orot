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
        let homeClinic = app.staticTexts[initialClinic]
        // Keep one short-circuiting observation before collecting any later accessibility diagnostics.
        let homeClinicExists = homeClinic.exists
        let homeClinicIsHittable = homeClinicExists && homeClinic.isHittable
        var homeClinicDiagnostics = ""
        if !homeClinicExists || !homeClinicIsHittable {
            let sameLabelTexts = app.staticTexts.matching(
                NSPredicate(format: "label == %@", initialClinic),
            )
            let sameLabelCount = sameLabelTexts.count
            let sampleCount = min(sameLabelCount, 3)
            let samples = (0 ..< sampleCount).map { index in
                let candidate = sameLabelTexts.element(boundBy: index)
                let candidateExists = candidate.exists
                let candidateIsHittable = candidateExists && candidate.isHittable
                return "candidate[\(index)] id=\(candidate.identifier) label=\(candidate.label) frame=\(candidate.frame.debugDescription) exists=\(candidateExists) isHittable=\(candidateIsHittable)"
            }
            let hittabilityObservation = homeClinicExists ? String(homeClinicIsHittable) : "not queried because exists was false"
            let samplesObservation = samples.isEmpty ? "none" : samples.joined(separator: "; ")
            homeClinicDiagnostics = """
            Original Home clinic assertion: exists=\(homeClinicExists), isHittable=\(hittabilityObservation).
            Same-label StaticText count=\(sameLabelCount); sampled \(samples.count) of \(sameLabelCount): \(samplesObservation).
            Follow-up accessibility reads and the screenshot are sequential observations after the original check. They add unmeasured time, synchronous accessibility IPC may block XCTest, and they do not establish the original check's state.
            """
            let attachment = XCTAttachment(screenshot: app.screenshot())
            attachment.name = "home-next-appointment-clinic-assertion"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        XCTAssertTrue(homeClinicExists && homeClinicIsHittable, "\(homeClinicDiagnostics)\n\(app.debugDescription)")
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
        NavigationUITestConditions.route(app, markers: ["home-open-schedule"])
    }
}
