import XCTest
@testable import NativeSwiftRegressions

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
        witness.acceptJS(feature: "pipeline", stage: "rn_bridge_attached", outcome: "failed")
        XCTAssertEqual(witness.snapshot()["launch"] as? Bool, true)
        XCTAssertEqual(witness.snapshot()["bridge"] as? Bool, false)
        witness.acceptJS(feature: "pipeline", stage: "rn_bridge_attached", outcome: "completed")
        witness.acceptJS(feature: "storage", stage: "recent_records_pre_admission", outcome: "unavailable")
        witness.acceptJS(feature: "workout_period", stage: "overview_route", outcome: "empty")
        witness.recordWorkout(.nativeGateRejected)
        XCTAssertEqual(witness.snapshot()["receipts"] as? [String], [
            "records recent_records_pre_admission unavailable", "workout overview_route empty",
            "workout native nativeGateRejected",
        ])
        for _ in 0 ..< 33 { witness.recordWorkout(.bridgeReceived) }
        let snapshot = witness.snapshot()
        XCTAssertEqual(snapshot["launch"] as? Bool, true)
        XCTAssertEqual(snapshot["bridge"] as? Bool, true)
        XCTAssertEqual(snapshot["receipts"] as? [String], Array(repeating: "workout native bridgeReceived", count: 32))
    }

    func testOnlyFixedFeatureSpecificTokensAreAccepted() throws {
        let witness = try XCTUnwrap(ProcessDiagnosticWitness.make(arguments: ["-OROT_PROVIDER_DIAGNOSTICS"]))
        witness.acceptJS(feature: "storage", stage: "recent_records_source_read", outcome: "88 BPM")
        witness.acceptJS(feature: "workout_period", stage: "records_bridge", outcome: "35")
        witness.acceptJS(feature: "storage", stage: "recent_records_source_read", outcome: "empty")
        witness.acceptJS(feature: "workout_period", stage: "overview_bridge", outcome: "stale_evidence")
        witness.acceptJS(feature: "storage", stage: "recent_records_supply_here", outcome: "completed")
        witness.acceptJS(feature: "other", stage: "recent_records_source_read", outcome: "completed")
        witness.acceptJS(feature: "workout_period", stage: "overview_bridge_83", outcome: "completed")
        XCTAssertEqual(witness.snapshot()["receipts"] as? [String], [])
    }
}
