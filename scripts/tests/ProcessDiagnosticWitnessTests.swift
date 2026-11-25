@testable import NativeSwiftRegressions
import XCTest

final class ProcessDiagnosticWitnessTests: XCTestCase {
    func testDisabledLaunchHasNoWitnessAndFreshInstanceHasNoEvidence() throws {
        XCTAssertNil(ProcessDiagnosticWitness.make(arguments: []))
        XCTAssertNil(ProcessDiagnosticWitness.make(arguments: ["-OROT_PROVIDER_DIAGNOSTICS=false"]))
        let fresh = try XCTUnwrap(ProcessDiagnosticWitness.make(arguments: ["-OROT_PROVIDER_DIAGNOSTICS"]))
        XCTAssertEqual(fresh.snapshot()["launch"] as? Bool, false)
        XCTAssertEqual(fresh.snapshot()["bridge"] as? Bool, false)
        XCTAssertEqual(fresh.snapshot()["receipts"] as? [String], [])
    }

    func testLaunchAndBridgeReceiptsRemainIndependentOfVolatileRing() throws {
        let witness = try XCTUnwrap(ProcessDiagnosticWitness.make(arguments: ["-OROT_PROVIDER_DIAGNOSTICS"]))
        witness.markLaunch()
        _ = witness.acceptAndContinueJS(feature: "pipeline", stage: "rn_bridge_attached", outcome: "failed")
        XCTAssertEqual(witness.snapshot()["launch"] as? Bool, true)
        XCTAssertEqual(witness.snapshot()["bridge"] as? Bool, false)
        _ = witness.acceptAndContinueJS(feature: "pipeline", stage: "rn_bridge_attached", outcome: "completed")
        _ = witness.acceptAndContinueJS(feature: "storage", stage: "recent_records_pre_admission", outcome: "unavailable")
        _ = witness.acceptAndContinueJS(feature: "workout_period", stage: "overview_route", outcome: "empty")
        witness.recordWorkout(.nativeGateRejected)
        XCTAssertEqual(witness.snapshot()["receipts"] as? [String], [
            "records recent_records_pre_admission unavailable", "workout overview_route empty",
            "workout native nativeGateRejected",
        ])
        for _ in 0 ..< 33 {
            witness.recordWorkout(.bridgeReceived)
        }
        let snapshot = witness.snapshot()
        XCTAssertEqual(snapshot["launch"] as? Bool, true)
        XCTAssertEqual(snapshot["bridge"] as? Bool, true)
        XCTAssertEqual(snapshot["receipts"] as? [String], Array(repeating: "workout native bridgeReceived", count: 32))
    }

    func testOnlyFixedFeatureSpecificTokensAreAccepted() throws {
        let witness = try XCTUnwrap(ProcessDiagnosticWitness.make(arguments: ["-OROT_PROVIDER_DIAGNOSTICS"]))
        _ = witness.acceptAndContinueJS(feature: "storage", stage: "recent_records_source_read", outcome: "88 BPM")
        _ = witness.acceptAndContinueJS(feature: "workout_period", stage: "records_bridge", outcome: "35")
        _ = witness.acceptAndContinueJS(feature: "storage", stage: "recent_records_source_read", outcome: "empty")
        _ = witness.acceptAndContinueJS(feature: "workout_period", stage: "overview_bridge", outcome: "stale_evidence")
        _ = witness.acceptAndContinueJS(feature: "storage", stage: "recent_records_supply_here", outcome: "completed")
        _ = witness.acceptAndContinueJS(feature: "other", stage: "recent_records_source_read", outcome: "completed")
        _ = witness.acceptAndContinueJS(feature: "workout_period", stage: "overview_bridge_83", outcome: "completed")
        XCTAssertEqual(witness.snapshot()["receipts"] as? [String], [])
    }

    func testRecordingDeletionIsRedactedAndDoesNotEnterTheSettingsRing() throws {
        let witness = try XCTUnwrap(ProcessDiagnosticWitness.make(arguments: ["-OROT_PROVIDER_DIAGNOSTICS"]))
        XCTAssertEqual(
            ProcessDiagnosticWitness.recordingDeletionLine(stage: "audio_cleanup", outcome: "started"),
            "OROT_PROVIDER_DIAGNOSTIC layer=app feature=recording_delete stage=audio_cleanup outcome=started",
        )
        let detailedStages = [
            "protected_database_open", "deletion_rag_prepare", "source_reference_snapshot",
            "memory_engine_acquire", "memory_forget", "memory_deletion_fences", "memory_batch_commit",
        ]
        for stage in detailedStages {
            XCTAssertEqual(
                ProcessDiagnosticWitness.recordingDeletionLine(stage: stage, outcome: "started"),
                "OROT_PROVIDER_DIAGNOSTIC layer=app feature=recording_delete stage=\(stage) outcome=started",
            )
            XCTAssertFalse(witness.acceptAndContinueJS(feature: "recording_delete", stage: stage, outcome: "started"))
        }
        XCTAssertNil(ProcessDiagnosticWitness.recordingDeletionLine(stage: "audio_cleanup", outcome: "source-id"))
        XCTAssertNil(ProcessDiagnosticWitness.recordingDeletionLine(stage: "private-path", outcome: "completed"))
        XCTAssertFalse(witness.acceptAndContinueJS(feature: "recording_delete", stage: "audio_cleanup", outcome: "started"))
        XCTAssertFalse(witness.acceptAndContinueJS(feature: "recording_delete", stage: "private-path", outcome: "failed"))
        XCTAssertEqual(witness.snapshot()["receipts"] as? [String], [])
    }

    func testRecentMediaAdmissionAcceptsOnlyClosedPageAndOutcomePairs() throws {
        let witness = try XCTUnwrap(ProcessDiagnosticWitness.make(arguments: ["-OROT_PROVIDER_DIAGNOSTICS"]))
        let first = [
            "recovered", "owner_missing", "owner_detached", "settlement_failed", "wait_expired",
            "budget_expired", "cap_missing_witness", "cap_revision_changed", "readmission_refused", "cancelled",
        ]
        let next = ["missing_witness", "revision_changed", "cancelled"]
        for (stage, outcomes) in [("first_page", first), ("next_page", next)] {
            for outcome in outcomes {
                XCTAssertEqual(
                    ProcessDiagnosticWitness.recordsMediaAdmissionLine(stage: stage, outcome: outcome),
                    "OROT_PROVIDER_DIAGNOSTIC layer=app feature=records_media_admission stage=" + stage +
                        " outcome=" + outcome
                )
                XCTAssertFalse(witness.acceptAndContinueJS(feature: "records_media_admission", stage: stage, outcome: outcome))
            }
        }
        XCTAssertNil(ProcessDiagnosticWitness.recordsMediaAdmissionLine(stage: "first_page", outcome: "revision_changed"))
        XCTAssertNil(ProcessDiagnosticWitness.recordsMediaAdmissionLine(stage: "next_page", outcome: "settlement_failed"))
        XCTAssertNil(ProcessDiagnosticWitness.recordsMediaAdmissionLine(stage: "first_page", outcome: "raw-protected-id"))
        XCTAssertNil(ProcessDiagnosticWitness.recordsMediaAdmissionLine(stage: "private-path", outcome: "recovered"))
        XCTAssertEqual(witness.snapshot()["receipts"] as? [String], [])
    }
}

