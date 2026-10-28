import XCTest

final class RecordingDeletionRecoveryUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
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
            extra: ["-OROT_RECORDING_DELETION_SCENARIO", "delayed-audio-cleanup"],
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

        UITestConditions.element(app, "recording-deletion-release-audio-cleanup").tap()
        UITestConditions.value(cleanup, equals: "released")
        waitUntilNotExists(row)
        waitUntilNotExists(progress)
    }

    @MainActor
    private func confirmSyntheticDeletion(in app: XCUIApplication) throws -> XCUIElement {
        let openSaved = UITestConditions.element(app, "recording-open-saved")
        XCTAssertTrue(openSaved.waitForAppearance(), app.debugDescription)
        openSaved.tap()
        XCTAssertTrue(
            UITestConditions.exists(UITestConditions.element(app, "recording-library-panel")),
            app.debugDescription,
        )

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
