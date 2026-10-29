import XCTest

/// Measures the native disclosure window and preserves its existing decline assertions.
@MainActor
enum DisclosureLayoutUITestObservations {
    /// Waits for the real Modal surface before comparing its bounds with the consent controls.
    static func waitForAndAssertControlsFitModal(
        _ app: XCUIApplication,
        in testCase: AppointmentConsentUITests,
    ) {
        XCTAssertTrue(testCase.node(app, "inference-disclosure-sheet").waitForAppearance())
        assertControlsFitModal(app, in: testCase)
    }

    /// Uses the Modal-owned frame so caller-screen width cannot make clipped consent controls appear valid.
    static func assertControlsFitModal(
        _ app: XCUIApplication,
        in testCase: AppointmentConsentUITests,
    ) {
        let modal = testCase.node(app, "inference-disclosure-sheet")
        XCTAssertTrue(modal.frame.width > 0 && modal.frame.height > 0, modal.debugDescription)
        let controls = [
            testCase.node(app, "inference-disclosure-recipient"),
            testCase.node(app, "inference-disclosure-scope"),
            testCase.node(app, "inference-disclosure-allow"),
            testCase.node(app, "inference-disclosure-cancel"),
        ]
        let page = testCase.node(app, "inference-disclosure-content")
        for control in controls {
            XCTAssertTrue(control.exists, control.debugDescription)
            FormUITestConditions.reveal(control, in: app, scroll: page)
            XCTAssertFalse(control.frame.isEmpty, control.debugDescription)
            XCTAssertTrue(modal.frame.contains(control.frame), control.debugDescription)
            XCTAssertTrue(control.isHittable, control.debugDescription)
        }
        XCTAssertFalse(
            controls[2].frame.intersects(controls[3].frame),
            "Allow and decline actions must retain separate measured hit regions",
        )
    }

    /// Verifies that the presented layout still declines without reaching the synthetic provider.
    static func cancelDisclosure(
        _ app: XCUIApplication,
        in testCase: AppointmentConsentUITests,
    ) {
        assertControlsFitModal(app, in: testCase)
        testCase.tap(app, "inference-disclosure-cancel")
        testCase.failureNotice(app, reason: "이 요청의 AI 처리 승인이 필요해요.")
        UITestConditions.value(
            testCase.node(app, "calendar-classification-synthetic-provider-calls"),
            equals: "syntheticProviderCalls=0",
        )
    }

    /// Opens the same consent dialog after rotation, then checks its actual frame and decline behavior.
    static func presentAndCancelDisclosure(
        _ app: XCUIApplication,
        in testCase: AppointmentConsentUITests,
    ) {
        testCase.tap(app, "medical-appointment-import")
        XCTAssertTrue(testCase.node(app, "inference-disclosure-sheet").waitForAppearance())
        cancelDisclosure(app, in: testCase)
    }
}
