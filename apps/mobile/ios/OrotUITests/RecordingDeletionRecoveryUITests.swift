import XCTest

final class RecordingDeletionRecoveryUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// Captures real microphone audio instead of seeding the synthetic deletion fixture.
    @MainActor
    func testFreshRecordingCanBeDeletedImmediatelyAfterStopAndSave() throws {
        let app = XCUIApplication()
        defer { UITestConditions.terminateStandaloneApp(app) }
        app.launch()
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        UITestConditions.element(app, "records-new-recording").tap()
        let consent = UITestConditions.element(app, "recording-consent")
        XCTAssertTrue(UITestConditions.exists(consent))
        consent.tap()
        let microphone = UITestConditions.element(app, "recording-microphone-control")
        microphone.tap()
        let status = UITestConditions.element(app, "recording-status")
        let permission = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch
        let started = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            permission.exists || UITestConditions.text(status) == "녹음 중"
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [started]), .completed, app.debugDescription)
        if permission.exists {
            let allow = permission.buttons.matching(
                NSPredicate(format: "label IN %@", ["Allow", "허용", "OK", "확인"]),
            ).firstMatch
            XCTAssertTrue(allow.exists, permission.debugDescription)
            allow.tap()
        }
        UITestConditions.value(status, equals: "녹음 중")
        let duration = UITestConditions.element(app, "recording-duration")
        // Observe the real recorder's advancing duration; no sleep or synthetic elapsed state.
        let captured = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            // Accessibility labels prefix the clock with "녹음 시간:"; values can contain just the clock.
            let clock = UITestConditions.text(duration).split(separator: " ").last?
                .split(separator: ":").compactMap { Int($0) } ?? []
            return clock.count == 2 && clock[0] * 60 + clock[1] >= 2
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [captured]), .completed, app.debugDescription)
        microphone.tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "recording-result")))
        let saved = UITestConditions.element(app, "recording-open-saved")
        let saveOrPermission = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            permission.exists || (saved.exists && saved.isEnabled)
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [saveOrPermission]), .completed, app.debugDescription)
        // First-use Speech authorization can follow save; acknowledge it without awaiting recognition.
        if permission.exists {
            let allow = permission.buttons.matching(
                NSPredicate(format: "label IN %@", ["Allow", "허용", "OK", "확인"]),
            ).firstMatch
            XCTAssertTrue(allow.exists, permission.debugDescription)
            allow.tap()
        }
        let savedReady = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == true AND enabled == true"), object: saved,
        )
        XCTAssertEqual(UITestConditions.wait(for: [savedReady]), .completed, app.debugDescription)
        // Enter as soon as save releases the screen; do not wait for automatic transcription.
        saved.tap()
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "recording-details-")).firstMatch
        XCTAssertTrue(UITestConditions.exists(row), app.debugDescription)
        let sourceId = String(row.identifier.dropFirst("recording-details-".count))
        XCTAssertNotNil(UUID(uuidString: sourceId))
        let delete = UITestConditions.element(app, "recording-delete-\(sourceId)")
        FormUITestConditions.reveal(delete, in: app, scrollID: "navigation-route-scroll")
        XCTAssertTrue(delete.isHittable, delete.debugDescription)
        delete.tap()
        let confirmation = app.alerts.firstMatch
        XCTAssertTrue(confirmation.waitForAppearance())
        let confirmedAt = ProcessInfo.processInfo.systemUptime
        confirmation.buttons.element(boundBy: 1).tap()
        let progress = UITestConditions.element(app, "recording-delete-progress")
        // XCTest can miss a short-lived indicator. Preserve missing observations rather than inventing pixel timing.
        let observedProgressAt: Double? = progress.exists ? ProcessInfo.processInfo.systemUptime : nil
        waitUntilNotExists(row)
        waitUntilNotExists(progress)
        XCTAssertFalse(UITestConditions.element(app, "recording-delete-error").exists, app.debugDescription)
        let absentAt = ProcessInfo.processInfo.systemUptime
        let observation: [String: Any] = [
            "scenario": "real-microphone-stop-save-immediate-delete",
            "minimumCaptureMs": 2000,
            "confirmationToObservedAbsenceMs": (absentAt - confirmedAt) * 1000,
            "progressFirstObservedAfterConfirmationMs": observedProgressAt.map { ($0 - confirmedAt) * 1000 } as Any? ?? NSNull(),
            "limit": "XCTest accessibility observation bounds, not native pixel presentation timestamps",
        ]
        let attachment = try XCTAttachment(
            data: JSONSerialization.data(withJSONObject: observation), uniformTypeIdentifier: "public.json",
        )
        attachment.name = "fresh-recording-deletion-observation"
        attachment.lifetime = .keepAlways
        add(attachment)

        app.terminate()
        app.launch()
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        UITestConditions.element(app, "records-new-recording").tap()
        let reopened = UITestConditions.element(app, "recording-open-saved")
        XCTAssertTrue(UITestConditions.exists(reopened))
        reopened.tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "recording-library-panel")))
        // Mounting precedes the list query. Require settled empty content and reject failed reads.
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "recording-library-empty")))
        let loadError = app.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@", "녹음 목록을 불러오지 못했어요."),
        ).firstMatch
        XCTAssertFalse(loadError.exists, app.debugDescription)
        XCTAssertFalse(UITestConditions.element(app, "recording-delete-\(sourceId)").exists)
    }

    @MainActor
    func testFailedDeletionRestoresAudioAndKeepsSourceDuringSlowListRead() throws {
        let app = XCUIApplication()
        RecordingFixtureUITestConditions.launch(
            app,
            extra: ["-OROT_RECORDING_DELETION_SCENARIO", "failure-slow-list-read"],
        )
        defer {
            if app.state != .notRunning {
                app.terminate()
            }
        }

        let row = try confirmSyntheticDeletion(in: app)
        let progress = UITestConditions.element(app, "recording-delete-progress")
        let error = UITestConditions.element(app, "recording-delete-error")
        XCTAssertTrue(error.waitForAppearance(), app.debugDescription)
        XCTAssertTrue(progress.waitForAppearance(), app.debugDescription)
        UITestConditions.value(
            UITestConditions.element(app, "recording-deletion-audio-restore-status"),
            equals: "restored",
        )
        let listRead = UITestConditions.element(app, "recording-deletion-slow-list-read-status")
        UITestConditions.value(listRead, equals: "waiting")
        XCTAssertTrue(row.exists, row.debugDescription)
        XCTAssertFalse(UITestConditions.element(app, "recording-delete-cleanup-pending").exists)

        UITestConditions.element(app, "recording-deletion-release-slow-list-read").tap()
        UITestConditions.value(listRead, equals: "released")
        waitUntilNotExists(progress)
        XCTAssertTrue(row.exists, row.debugDescription)
        XCTAssertTrue(error.exists, app.debugDescription)
    }

    @MainActor
    func testDelayedAudioCleanupKeepsProgressUntilCleanupCompletes() throws {
        let app = XCUIApplication()
        RecordingFixtureUITestConditions.launch(
            app,
            extra: [
                "-OROT_RECORDING_DELETION_SCENARIO",
                "delayed-audio-cleanup",
                "-OROT_RECORDING_DELETION_TIMING",
                "YES",
            ],
        )
        defer {
            if app.state != .notRunning {
                app.terminate()
            }
        }

        let row = try confirmSyntheticDeletion(in: app)
        let progress = UITestConditions.element(app, "recording-delete-progress")
        let cleanup = UITestConditions.element(app, "recording-deletion-audio-cleanup-status")
        XCTAssertTrue(progress.waitForAppearance(), app.debugDescription)
        UITestConditions.value(cleanup, equals: "waiting")
        XCTAssertTrue(row.exists, row.debugDescription)
        XCTAssertFalse(UITestConditions.element(app, "recording-delete-error").exists)
        XCTAssertFalse(UITestConditions.element(app, "recording-delete-cleanup-pending").exists)

        // Keep the progress state visible until its native layout timing mark can be reported.
        UITestConditions.element(app, "recording-deletion-release-audio-cleanup").tap()
        UITestConditions.value(cleanup, equals: "released")
        waitUntilNotExists(row)
        waitUntilNotExists(progress)

        let timingReportElement = UITestConditions.element(app, "recording-deletion-timing-report")
        XCTAssertTrue(timingReportElement.waitForAppearance(), app.debugDescription)
        let encodedReport = UITestConditions.text(timingReportElement)
        let reportData = try XCTUnwrap(encodedReport.data(using: .utf8))
        let report = try XCTUnwrap(JSONSerialization.jsonObject(with: reportData) as? [String: Any])
        XCTAssertEqual(report["complete"] as? Bool, true, encodedReport)
        XCTAssertEqual(report["succeeded"] as? Bool, true, encodedReport)
        let events = try XCTUnwrap(report["events"] as? [[String: Any]], encodedReport)
        let progressIndex = try XCTUnwrap(
            events.firstIndex {
                $0["stage"] as? String == "progress-presented" && $0["phase"] as? String == "mark"
            },
            encodedReport,
        )
        let listRefreshIndex = try XCTUnwrap(
            events.firstIndex {
                $0["stage"] as? String == "list-refresh" && $0["phase"] as? String == "mark"
            },
            encodedReport,
        )
        XCTAssertLessThan(progressIndex, listRefreshIndex, encodedReport)
    }

    @MainActor
    private func confirmSyntheticDeletion(in app: XCUIApplication) throws -> XCUIElement {
        // This fixture embeds the library because it does not provide the app navigation callback.
        let library = UITestConditions.element(app, "recording-library-panel")
        XCTAssertTrue(library.waitForAppearance(), app.debugDescription)

        let row = app.buttons.matching(
            NSPredicate(format: "label CONTAINS %@", "Synthetic transcription test recording"),
        ).firstMatch
        FormUITestConditions.reveal(row, in: app, scrollID: "recording-controls-scroll")
        XCTAssertTrue(row.identifier.hasPrefix("recording-details-"), row.debugDescription)
        let sourceId = String(row.identifier.dropFirst("recording-details-".count))
        XCTAssertNotNil(UUID(uuidString: sourceId), row.debugDescription)

        let delete = UITestConditions.element(app, "recording-delete-\(sourceId)")
        FormUITestConditions.reveal(delete, in: app, scrollID: "recording-controls-scroll")
        XCTAssertTrue(delete.isHittable, delete.debugDescription)
        delete.tap()
        let confirmation = app.alerts.firstMatch
        XCTAssertTrue(confirmation.waitForAppearance(), app.debugDescription)
        confirmation.buttons.element(boundBy: 1).tap()
        return row
    }

    @MainActor
    private func waitUntilNotExists(_ element: XCUIElement) {
        let condition = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: element,
        )
        XCTAssertEqual(XCTWaiter.wait(for: [condition], timeout: 60), .completed, element.debugDescription)
    }
}
