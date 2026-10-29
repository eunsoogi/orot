import XCTest

/// Keeps the next-visit journey readable while preserving its existing XCTest class and selector.
extension AppointmentsUITests {
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
        // The row button exposes next-visit meaning even though its badge is not a separate native element.
        let nextVisitRow = app.buttons["appointment-select-manual-1"]
        XCTAssertTrue(nextVisitRow.waitForAppearance(), app.debugDescription)
        XCTAssertTrue(nextVisitRow.label.contains("다음 진료"), app.debugDescription)
        try NavigationUITestConditions.tapNavigation(app, "appointments-back")
        NavigationUITestConditions.route(app, markers: ["home-next-appointment"])
        let homeClinic = app.staticTexts["Cardiology clinic"]
        XCTAssertTrue(homeClinic.exists && homeClinic.isHittable, app.debugDescription)
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
        let cancelledRowLabel = nextVisitRow.label
        XCTAssertTrue(cancelledRowLabel.contains("취소됨"), app.debugDescription)
        XCTAssertFalse(cancelledRowLabel.contains("다음 진료"), app.debugDescription)
        app.terminate()
        try launch(app)
        visible(app, "Neurology clinic")
        visible(app, "2027년 6월 3일 10:15 · 현지 시간")
        visible(app, "취소됨")
        try NavigationUITestConditions.tapNavigation(app, "appointments-back")
        NavigationUITestConditions.route(app, markers: ["home-open-schedule"])
    }
}
