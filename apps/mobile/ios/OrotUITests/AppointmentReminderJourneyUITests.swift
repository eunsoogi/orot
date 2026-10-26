import XCTest

/// Real notification center, permission sheet and SpringBoard taps serve the normal App.
final class AppointmentReminderJourneyUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testLocalReplacementCancellationAndActualRunningAndColdNotificationTaps() throws {
        let app = XCUIApplication()
        defer { UITestConditions.terminateStandaloneApp(app) }
        try ReminderJourneyForm.start(app, session: UUID().uuidString)
        var originalAppearance: AppearanceUITestConditions.Snapshot?
        defer {
            if let originalAppearance, app.state == .runningForeground {
                do { try AppearanceUITestConditions.restore(originalAppearance, returningTo: app, testCase: self) }
                catch { XCTFail("Could not restore owned window appearance: \(error)") }
            }
        }
        let initial = try ReminderJourneyObservation.fresh(app, stage: "initial-off", testCase: self)
        XCTAssertEqual(initial.authorization, 0)
        XCTAssertTrue(initial.pending.isEmpty)
        _ = try ReminderJourneyForm.create(app, clinic: "먼저 있는 합성 예약", start: ReminderJourneyForm.time(minutesAhead: 30), note: "합성 자료")
        let originalTime = ReminderJourneyForm.time(minutesAhead: 120)
        let id = try ReminderJourneyForm.create(app, clinic: ReminderJourneyForm.clinic, start: originalTime)
        ReminderJourneyForm.tap(app, "appointment-reminder-\(id)-60")
        try ReminderJourneyObservation.allowFirstNotification(app, testCase: self)
        try ReminderJourneyObservation.assertPending(app, id: id, start: originalTime, stage: "initial-schedule", testCase: self)
        for dark in [false, true] {
            _ = try AppearanceUITestConditions.select(dark, returningTo: app, testCase: self, captureOriginal: {
                if originalAppearance == nil {
                    originalAppearance = $0
                }
            })
            ReminderJourneyForm.inspectControls(app, id: id, name: dark ? "default-dark" : "default-light", testCase: self)
        }

        let movedTime = ReminderJourneyForm.time(minutesAhead: 100)
        ReminderJourneyForm.edit(app, id: id, start: movedTime)
        try ReminderJourneyObservation.assertPending(app, id: id, start: movedTime, stage: "replacement", testCase: self)
        ReminderJourneyForm.tap(app, "appointment-cancel-" + id)
        let cancelled = try ReminderJourneyObservation.fresh(app, stage: "cancelled", testCase: self)
        XCTAssertTrue(cancelled.pending.isEmpty)

        let runningTime = ReminderJourneyForm.time(minutesAhead: 63)
        let selectedID = try ReminderJourneyForm.create(app, clinic: ReminderJourneyForm.clinic, start: runningTime)
        ReminderJourneyForm.tap(app, "appointment-reminder-\(selectedID)-60")
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["알림이 설정되었어요."]))
        try ReminderJourneyObservation.assertPending(app, id: selectedID, start: runningTime, stage: "running-schedule", testCase: self)
        let process = try ReminderJourneyObservation.fresh(app, stage: "before-running-tap", testCase: self).processID
        try ReminderJourneyObservation.tapActualNotification(app, cold: false, testCase: self)
        ReminderJourneyForm.inspectPreparation(app, name: "running-selected-visit", testCase: self)
        XCTAssertEqual(try ReminderJourneyObservation.fresh(app, stage: "after-running-tap", testCase: self).processID, process)
        for dark in [false, true] {
            _ = try AppearanceUITestConditions.select(dark, returningTo: app, testCase: self)
            ReminderJourneyForm.inspectPreparation(app, name: dark ? "default-dark" : "default-light", testCase: self)
        }
        if let originalAppearance {
            try AppearanceUITestConditions.restore(originalAppearance, returningTo: app, testCase: self)
        }
        originalAppearance = nil

        try ReminderJourneyForm.openAppointments(app)
        let coldTime = ReminderJourneyForm.time(minutesAhead: 63)
        ReminderJourneyForm.edit(app, id: selectedID, start: coldTime)
        try ReminderJourneyObservation.assertPending(app, id: selectedID, start: coldTime, stage: "cold-schedule", testCase: self)
        try ReminderJourneyObservation.tapActualNotification(app, cold: true, testCase: self)
        ReminderJourneyForm.inspectPreparation(app, name: "cold-selected-visit", testCase: self)
    }

    @MainActor
    func testReminderControlsAndPreparationAcrossAppearancesAndLargeText() throws {
        let app = XCUIApplication()
        let session = UUID().uuidString
        try ReminderJourneyForm.start(app, session: session, large: true)
        var original: AppearanceUITestConditions.Snapshot?
        var completed = false
        defer {
            if completed, let original {
                do { try AppearanceUITestConditions.restore(original, returningTo: app, testCase: self) }
                catch { XCTFail("Could not restore owned window appearance: \(error)") }
            }
            UITestConditions.terminateStandaloneApp(app)
        }
        let typography = try ReminderJourneyObservation.fresh(app, stage: "large-text", testCase: self)
        XCTAssertGreaterThanOrEqual(typography.fontScale, 1.5)
        XCTAssertTrue(typography.contentSizeCategory.contains("Accessibility"))
        let initialTime = ReminderJourneyForm.time(minutesAhead: 120)
        let id = try ReminderJourneyForm.create(app, clinic: ReminderJourneyForm.clinic, start: initialTime)
        ReminderJourneyForm.tap(app, "appointment-reminder-\(id)-60")
        if typography.authorization == 0 {
            try ReminderJourneyObservation.allowFirstNotification(app, testCase: self)
        } else {
            // iOS may retain the prior case's permission across an ordinary app reinstall.
            XCTAssertEqual(typography.authorization, 2)
            XCTAssertTrue(UITestConditions.exists(app.staticTexts["알림이 설정되었어요."]))
        }
        try ReminderJourneyObservation.assertPending(app, id: id, start: initialTime, stage: "large-initial-schedule", testCase: self)
        for dark in [false, true] {
            _ = try AppearanceUITestConditions.select(dark, returningTo: app, testCase: self, captureOriginal: {
                if original == nil {
                    original = $0
                }
            })
            ReminderJourneyForm.inspectControls(app, id: id, name: dark ? "large-dark" : "large-light", testCase: self)
        }
        try ReminderJourneyObservation.selectHighContrast(app, testCase: self)
        ReminderJourneyForm.inspectControls(app, id: id, name: "large-high-contrast", testCase: self)
        let deliveryTime = ReminderJourneyForm.time(minutesAhead: 63)
        ReminderJourneyForm.edit(app, id: id, start: deliveryTime)
        try ReminderJourneyObservation.assertPending(app, id: id, start: deliveryTime, stage: "large-delivery-schedule", testCase: self)
        try ReminderJourneyObservation.tapActualNotification(app, cold: false, testCase: self)
        for dark in [false, true] {
            _ = try AppearanceUITestConditions.select(dark, returningTo: app, testCase: self)
            ReminderJourneyForm.inspectPreparation(app, name: dark ? "large-dark" : "large-light", testCase: self)
        }
        let receipt = try ReminderJourneyObservation.fresh(app, stage: "large-preparation", testCase: self)
        XCTAssertGreaterThanOrEqual(receipt.fontScale, 1.5)
        XCTAssertEqual(receipt.contrast, 2)
        completed = true
    }
}
