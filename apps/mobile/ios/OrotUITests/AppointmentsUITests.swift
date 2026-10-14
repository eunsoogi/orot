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
        let started = ProcessInfo.processInfo.systemUptime
        defer {
            // Keep the original scenario's 180-second UI budget; individual field waits must not silently enlarge it.
            XCTAssertLessThanOrEqual(ProcessInfo.processInfo.systemUptime - started, 180)
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

    @MainActor
    private func launch(_ app: XCUIApplication) throws {
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-OROT_E2E_PROBE", "appointments", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        UITestConditions.value(UITestConditions.element(app, "appointments-title"), equals: "예약")
        XCTAssertTrue(UITestConditions.element(app, "appointment-add").isHittable)
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
    private func fill(_ app: XCUIApplication, clinic: String, date: String, time: String, note: String) {
        for (field, value) in [("clinic", clinic), ("date", date), ("time", time), ("note", note)] {
            let input = app.textFields.matching(identifier: "appointment-\(field)-input").firstMatch
            XCTAssertTrue(UITestConditions.exists(input))
            FormUITestConditions.replace(input, with: value, in: app, scrollID: "appointments-scroll")
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
