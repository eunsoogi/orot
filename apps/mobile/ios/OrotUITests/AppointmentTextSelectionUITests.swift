import XCTest

/// Captures the real clinic-field edit boundary before deletion, using only one synthetic appointment.
final class AppointmentTextSelectionUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testCommandASelectionStateBeforeDelete() {
        let app = XCUIApplication()
        let originalClinic = "Cardiology clinic"
        var beforeSelect: InputObservation?
        var beforeDelete: InputObservation?
        var afterDelete: InputObservation?
        defer {
            if app.state != .notRunning {
                app.terminate()
            }
        }

        launch(app)
        UITestConditions.value(UITestConditions.element(app, "appointments-empty"), equals: "등록된 예약이 없어요.")
        createAppointment(app, clinic: originalClinic)

        app.terminate()
        launch(app)
        // One synthetic appointment keeps the existing journey's edit button label unique.
        let edit = app.buttons["수정"]
        XCTAssertTrue(edit.waitForAppearance(), app.debugDescription)
        FormUITestConditions.reveal(edit, in: app, scrollID: "appointments-scroll")
        XCTAssertTrue(edit.isHittable, edit.debugDescription)
        edit.tap()

        let clinic = app.textFields.matching(identifier: "appointment-clinic-input").firstMatch
        let replaced = FormUITestConditions.replace(
            clinic,
            with: "Neurology clinic",
            in: app,
            scrollID: "appointments-scroll",
            observeInput: { phase in
                switch phase {
                case .beforeSelect:
                    beforeSelect = self.observe(clinic, in: app, phase: "before-select")
                case .beforeDelete:
                    // This callback runs after native Command-A and before the original Delete action.
                    self.captureSelectionScreenshot(app)
                    beforeDelete = self.observe(clinic, in: app, phase: "before-delete")
                case .afterDelete:
                    afterDelete = self.observe(clinic, in: app, phase: "after-delete")
                default:
                    break
                }
            },
        )

        XCTAssertEqual(beforeSelect?.value, originalClinic)
        XCTAssertEqual(beforeSelect?.focused, true)
        XCTAssertEqual(beforeSelect?.keyboardVisible, true)
        XCTAssertTrue(beforeSelect?.hittable ?? false)
        XCTAssertEqual(beforeDelete?.value, originalClinic)
        XCTAssertEqual(beforeDelete?.focused, true)
        XCTAssertEqual(beforeDelete?.keyboardVisible, true)
        XCTAssertTrue(beforeDelete?.hittable ?? false)
        XCTAssertEqual(afterDelete?.value, "")
        XCTAssertTrue(replaced, "The original exact-empty assertion and replacement must both pass.")
    }

    @MainActor
    private func launch(_ app: XCUIApplication) {
        app.launchArguments = [
            "-OROT_TEST_PROFILE", "core",
            "-OROT_E2E_PROBE", "appointments",
            "-AppleLanguages", "(en)",
            "-AppleLocale", "en_US",
        ]
        app.launch()
        UITestConditions.value(UITestConditions.element(app, "appointments-title"), equals: "예약")
    }

    @MainActor
    private func createAppointment(_ app: XCUIApplication, clinic: String) {
        tap(app, "appointment-add")
        for (field, value) in [
            ("clinic", clinic),
            ("date", "2027-06-02"),
            ("time", "09:45"),
            ("note", "Bring the test results."),
        ] {
            let input = app.textFields.matching(identifier: "appointment-\(field)-input").firstMatch
            XCTAssertTrue(UITestConditions.exists(input))
            XCTAssertTrue(FormUITestConditions.replace(input, with: value, in: app, scrollID: "appointments-scroll"))
        }
        app.textFields.matching(identifier: "appointment-note-input").firstMatch.typeText("\n")
        tap(app, "appointment-save")
        XCTAssertTrue(app.buttons["Cardiology clinic 예약 취소"].exists, app.debugDescription)
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ identifier: String) {
        let target = UITestConditions.element(app, identifier)
        XCTAssertTrue(UITestConditions.exists(target))
        FormUITestConditions.reveal(target, in: app, scrollID: "appointments-scroll")
        XCTAssertTrue(target.isHittable, target.debugDescription)
        target.tap()
    }

    @MainActor
    private func observe(_ input: XCUIElement, in app: XCUIApplication, phase: String) -> InputObservation {
        let focused = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier == %@ AND hasKeyboardFocus == true", input.identifier))
            .count > 0
        let observation = InputObservation(
            phase: phase,
            value: input.value as? String,
            keyboardVisible: app.keyboards.firstMatch.exists,
            focused: focused,
            hittable: input.exists && input.isHittable,
        )
        print("OROT_APPOINTMENT_INPUT_SELECTION \(observation)")
        return observation
    }

    @MainActor
    private func captureSelectionScreenshot(_ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "appointment-command-a-before-delete"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

private struct InputObservation: CustomStringConvertible {
    let phase: String
    let value: String?
    let keyboardVisible: Bool
    let focused: Bool
    let hittable: Bool

    var description: String {
        "phase=\(phase);value=\(value ?? "unknown");keyboard=\(keyboardVisible);focused=\(focused);hittable=\(hittable)"
    }
}
