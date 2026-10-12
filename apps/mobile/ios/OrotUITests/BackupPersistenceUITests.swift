import XCTest

/// These tests require the dedicated backup runner: it installs a fresh container between independent cases.
final class BackupPersistenceUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testKeyAndMemoryTombstonesSurviveProcessRestart() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        _ = try probe(app, mode: "seed", timeout: 90)
        app.terminate()
        let result = try probe(app, mode: "recover")
        XCTAssertEqual(result["evidenceScope"] as? String, "synthetic-simulator-process-restart")
        XCTAssertEqual(result["keyMigration"] as? String, "migrated")
        truths(result, ["keyPreserved", "keyEligible", "storageRelationsReopened", "agentMemoryTombstonePreserved"])
        let recording = try XCTUnwrap(result["recording"] as? [String: Any])
        XCTAssertEqual(recording["excludedFromBackup"] as? Bool, false)
        let protection = try XCTUnwrap(recording["fileProtection"] as? String)
        XCTAssertTrue(["complete", "unverified", "not-complete"].contains(protection))
        XCTAssertTrue(try ["ready", "simulator-protection-unverified"].contains(XCTUnwrap(recording["strictPreparation"] as? String)))
        XCTAssertEqual(recording["sourcePersisted"] as? Bool, protection == "complete")
    }

    @MainActor
    func testLegacyRecordingRetainsStrictSourceProtectionGate() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        let result = try probe(app, mode: "legacy-recording", timeout: 90)
        let recording = try XCTUnwrap(result["recording"] as? [String: Any])
        truths(recording, ["legacyExcludedBefore", "fileReadable"])
        XCTAssertEqual(recording["excludedFromBackup"] as? Bool, false)
        if recording["fileProtection"] as? String == "complete" {
            truths(recording, ["preparationReady", "sourcePersisted", "transcriptLinked"])
            XCTAssertEqual(recording["strictPreparation"] as? String, "ready")
            XCTAssertEqual(recording["preparedCount"] as? Int, 1)
            XCTAssertEqual(recording["preparationError"] as? String, "none")
        } else {
            // Preserve the sole accepted Simulator limitation; a real protection failure must still fail.
            XCTAssertEqual(recording["fileProtection"] as? String, "unverified")
            for field in ["preparationReady", "sourcePersisted", "transcriptLinked"] {
                XCTAssertEqual(recording[field] as? Bool, false, field)
            }
            XCTAssertEqual(recording["strictPreparation"] as? String, "not-ready")
            XCTAssertEqual(recording["preparedCount"] as? Int, 0)
            XCTAssertEqual(recording["preparationError"] as? String, "protection-not-applied")
        }
    }

    @MainActor
    func testFailedKeyMigrationRollsBackAndRecoversAfterRestart() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        let failed = try probe(app, mode: "rollback")
        XCTAssertEqual(failed["evidenceScope"] as? String, "synthetic-simulator-process-restart")
        truths(failed, ["keyPreserved", "rollbackVerified"])
        XCTAssertEqual(failed["keyEligible"] as? Bool, false)
        XCTAssertEqual(failed["keyAccessibility"] as? String, "this-device-only")
        app.terminate()
        let recovered = try probe(app, mode: "rollback-recover")
        XCTAssertEqual(recovered["keyMigration"] as? String, "migrated")
        truths(recovered, ["keyPreserved", "keyEligible", "storageRelationsReopened"])
    }

    @MainActor
    func testSeedAppContainerSnapshot() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        let result = try probe(app, mode: "snapshot-seed")
        XCTAssertEqual(result["evidenceScope"] as? String, "synthetic-simulator-app-container-snapshot")
        truths(result, ["keyEligible"])
        let recording = try XCTUnwrap(result["recording"] as? [String: Any])
        XCTAssertNotNil(try UUID(uuidString: XCTUnwrap(recording["recordingId"] as? String)))
        truths(recording, ["sourcePersisted", "transcriptLinked", "fileReadable"])
        XCTAssertEqual(recording["excludedFromBackup"] as? Bool, false)
    }

    @MainActor
    func testRecoverAppContainerSnapshot() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        // The host restores files into a reinstalled container and passes only the validated synthetic UUID.
        let recordingID = try XCTUnwrap(ProcessInfo.processInfo.environment["OROT_BACKUP_SNAPSHOT_RECORDING_ID"])
        XCTAssertNotNil(UUID(uuidString: recordingID))
        let result = try probe(app, mode: "snapshot-recover", recordingID: recordingID)
        XCTAssertEqual(result["evidenceScope"] as? String, "synthetic-simulator-app-container-snapshot")
        truths(result, ["keyPreserved", "keyEligible", "storageRelationsReopened", "agentMemoryTombstonePreserved"])
        let recording = try XCTUnwrap(result["recording"] as? [String: Any])
        XCTAssertEqual(recording["recordingId"] as? String, recordingID)
        truths(recording, ["sourcePersisted", "transcriptLinked", "fileReadable"])
        XCTAssertEqual(recording["excludedFromBackup"] as? Bool, false)
        XCTAssertEqual(recording["sourceFixture"] as? String, "pre-existing-synthetic-snapshot-record")
    }

    @MainActor
    private func probe(_ app: XCUIApplication, mode: String, timeout: TimeInterval = 120, recordingID: String? = nil) throws -> [String: Any] {
        app.launchArguments = ["-OROT_TEST_SCENARIO", "backup", "-OROT_BACKUP_PROBE", mode]
        if let recordingID {
            app.launchArguments += ["-OROT_BACKUP_PROBE_RECORDING_ID", recordingID]
        }
        app.launch()
        let start = UITestConditions.element(app, "backup-probe-start")
        XCTAssertTrue(start.waitForExistence(timeout: 30), app.debugDescription)
        start.tap()
        let success = UITestConditions.element(app, "backup-probe-\(mode)-success")
        let failure = UITestConditions.element(app, "backup-probe-\(mode)-failure")
        let finished = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            success.exists || failure.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: timeout), .completed, app.debugDescription)
        XCTAssertTrue(success.exists, app.debugDescription)
        let output = UITestConditions.text(UITestConditions.element(app, "backup-probe-result"))
        let data = Data(output.utf8)
        let result = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "backup-\(mode)-observed-result"
        attachment.lifetime = .keepAlways
        add(attachment)
        return result
    }

    private func truths(_ result: [String: Any], _ fields: [String]) {
        for field in fields {
            XCTAssertEqual(result[field] as? Bool, true, field)
        }
    }
}
