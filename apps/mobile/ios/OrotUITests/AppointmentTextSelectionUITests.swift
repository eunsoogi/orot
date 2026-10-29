import XCTest

/// Verifies ASCII and Unicode clinic replacements through the native edit menu with one synthetic appointment.
final class AppointmentTextSelectionUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testAppointmentClinicReplacementClearsASCIIAndUnicodeValues() {
        let app = XCUIApplication()
        let originalClinic = "Cardiology clinic"
        defer {
            if app.state != .notRunning {
                app.terminate()
            }
        }

        launch(app, language: "ko")
        UITestConditions.value(UITestConditions.element(app, "appointments-empty"), equals: "등록된 예약이 없어요.")
        createAppointment(app, clinic: originalClinic)

        app.terminate()
        launch(app, language: "ko")
        // One synthetic appointment keeps the existing journey's edit button label unique.
        let edit = app.buttons["수정"]
        XCTAssertTrue(edit.waitForAppearance(), app.debugDescription)
        FormUITestConditions.reveal(edit, in: app, scrollID: "appointments-scroll")
        XCTAssertTrue(edit.isHittable, edit.debugDescription)
        edit.tap()

        let clinic = app.textFields.matching(identifier: "appointment-clinic-input").firstMatch
        let replacements = ["Neurology clinic", "진료 예약 🩺", "Neurology clinic"]
        var currentClinic = originalClinic
        for (index, replacement) in replacements.enumerated() {
            var beforeSelect: InputObservation?
            var afterSelect: InputObservation?
            var beforeDelete: InputObservation?
            var afterDelete: InputObservation?
            let replaced = FormUITestConditions.replace(
                clinic,
                with: replacement,
                in: app,
                scrollID: "appointments-scroll",
                observeInput: { phase in
                    switch phase {
                    case .beforeSelect:
                        beforeSelect = self.observe(clinic, in: app, phase: "before-select-\(index)")
                    case .afterSelect:
                        self.captureSelectionScreenshot(app, phase: "after-select-\(index)")
                        self.captureAccessibilityHierarchy(app, phase: "after-select-\(index)")
                        afterSelect = self.observe(clinic, in: app, phase: "after-select-\(index)")
                    case .beforeDelete:
                        beforeDelete = self.observe(clinic, in: app, phase: "before-delete-\(index)")
                    case .afterDelete:
                        afterDelete = self.observe(clinic, in: app, phase: "after-delete-\(index)")
                    default:
                        break
                    }
                },
                useNativeSelectAllMenu: true,
            )

            XCTAssertEqual(beforeSelect?.value, currentClinic)
            XCTAssertEqual(beforeSelect?.focused, true)
            XCTAssertEqual(beforeSelect?.keyboardVisible, true)
            XCTAssertTrue(beforeSelect?.hittable ?? false)
            XCTAssertEqual(afterSelect?.value, currentClinic)
            XCTAssertEqual(afterSelect?.focused, true)
            XCTAssertEqual(afterSelect?.keyboardVisible, true)
            XCTAssertTrue(afterSelect?.hittable ?? false)
            XCTAssertEqual(beforeDelete?.value, currentClinic)
            XCTAssertEqual(beforeDelete?.focused, true)
            XCTAssertEqual(beforeDelete?.keyboardVisible, true)
            XCTAssertTrue(beforeDelete?.hittable ?? false)
            XCTAssertEqual(afterDelete?.value, "")
            XCTAssertTrue(replaced, "The exact-empty assertion and replacement must both pass.")
            currentClinic = replacement
        }
    }

    @MainActor
    private func launch(_ app: XCUIApplication, language: String = "en") {
        let locale = language == "ko" ? "ko_KR" : "en_US"
        app.launchArguments = [
            "-OROT_TEST_PROFILE", "core",
            "-OROT_E2E_PROBE", "appointments",
            "-AppleLanguages", "(\(language))",
            "-AppleLocale", locale,
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
    private func captureSelectionScreenshot(_ app: XCUIApplication, phase: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "appointment-clinic-\(phase)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func captureAccessibilityHierarchy(_ app: XCUIApplication, phase: String) {
        let attachment = XCTAttachment(string: app.debugDescription)
        attachment.name = "appointment-clinic-\(phase)-accessibility"
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

@MainActor
enum AppointmentTextSelectionUITestConditions {
    /// Measures the observed system edit action so the appointment path preserves its existing timing diagnostics.
    static func selectAll(
        _ input: XCUIElement,
        in app: XCUIApplication,
        measure: (_ step: String, _ operation: () -> Void) -> Void,
    ) -> Bool {
        measure("select-existing") { input.press(forDuration: 1) }
        let selectAll = app.menuItems["Select All"]
        guard selectAll.exists, selectAll.isHittable else { XCTFail("Select All missing"); return false }
        measure("select-all") { selectAll.tap() }
        return true
    }
}
