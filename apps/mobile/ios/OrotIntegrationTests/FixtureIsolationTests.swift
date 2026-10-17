import Foundation
@testable import Orot
import XCTest

/// Two native processes prepare their own state before React and prove real database cleanup and key renewal.
final class FixtureIsolationTests: OrotFailFastTestCase {
    func testSeedActualEncryptedDatabaseBeforeScopedReset() async throws {
        let token = try token()
        let before = try preparedState(token)
        let result = try await operation("seed", token: token)
        XCTAssertEqual(result["seeded"] as? Bool, true)
        let after = try TestFixtureState.snapshot(token)
        XCTAssertNotNil(after["keyFingerprint"] as? String)
        try attach(["before": before, "state": after, "result": result, "reset": resetReceipt(token),
                    "processIdentifier": ProcessInfo.processInfo.processIdentifier], name: "fixture-isolation-seeded")
    }

    func testScopedResetRemovesPollutionBeforeNewDatabaseOpen() async throws {
        let token = try token()
        let text = try XCTUnwrap(ProcessInfo.processInfo.environment["OROT_FIXTURE_BASELINE"])
        let baseline = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        XCTAssertNotEqual(baseline["processIdentifier"] as? Int, Int(ProcessInfo.processInfo.processIdentifier))
        let before = try preparedState(token)
        XCTAssertEqual(before["foreignFile"] as? Bool, true)
        XCTAssertEqual(before["foreignKey"] as? Bool, true)
        XCTAssertEqual(before["foreignPreference"] as? Bool, true)
        let result = try await operation("verify", token: token)
        XCTAssertEqual(result["oldRecordAbsent"] as? Bool, true)
        let after = try TestFixtureState.snapshot(token)
        let previous = try XCTUnwrap(baseline["state"] as? [String: Any])
        let fingerprint = try XCTUnwrap(after["keyFingerprint"] as? String)
        XCTAssertNotEqual(fingerprint, previous["keyFingerprint"] as? String)
        XCTAssertEqual(after["foreignFile"] as? Bool, true)
        XCTAssertEqual(after["foreignKey"] as? Bool, true)
        XCTAssertEqual(after["foreignPreference"] as? Bool, true)
        try attach(["before": before, "after": after, "result": result, "reset": resetReceipt(token),
                    "processIdentifier": ProcessInfo.processInfo.processIdentifier], name: "fixture-isolation-verified")
        try TestFixtureState.removeSentinels(token)
    }

    private func token() throws -> String {
        let value = try XCTUnwrap(ProcessInfo.processInfo.environment["OROT_FIXTURE_TOKEN"])
        XCTAssertNotNil(UUID(uuidString: value))
        return value
    }

    private func resetReceipt(_ token: String) throws -> [String: Any] {
        let receipt = try XCTUnwrap(TestFixtureCommand.isolationReset)
        XCTAssertEqual(receipt["ok"] as? Bool, true)
        XCTAssertEqual(receipt["token"] as? String, token)
        XCTAssertEqual(receipt["processIdentifier"] as? Int, Int(ProcessInfo.processInfo.processIdentifier))
        return receipt
    }

    private func preparedState(_ token: String) throws -> [String: Any] {
        let reset = try resetReceipt(token)
        let contaminated = try XCTUnwrap(reset["before"] as? [String: Any])
        let preferences = try XCTUnwrap(contaminated["preferences"] as? [String: Bool])
        XCTAssertEqual(preferences.count, 2)
        XCTAssertTrue(preferences.values.allSatisfy(\.self))
        XCTAssertEqual(contaminated["foreignPreference"] as? Bool, true)
        let clean = try XCTUnwrap(reset["state"] as? [String: Any])
        try attach(reset, name: "fixture-isolation-startup-reset")
        try assertClean(clean)
        let current = try TestFixtureState.snapshot(token)
        // Preserve the original current-process absence assertions as well as the pre-React preparation proof.
        try assertClean(current)
        return current
    }

    private func assertClean(_ state: [String: Any]) throws {
        let paths = try XCTUnwrap(state["paths"] as? [String: Bool])
        let keys = try XCTUnwrap(state["keys"] as? [String: Bool])
        XCTAssertEqual(paths.count, 6)
        XCTAssertEqual(keys.count, 5)
        XCTAssertTrue(paths.values.allSatisfy { !$0 })
        XCTAssertTrue(keys.values.allSatisfy { !$0 })
        // Both startup and current snapshots must prove absence of the declared keys; unrelated React preferences may remain.
        XCTAssertEqual(state["pollutedPreferencesAbsent"] as? Bool, true)
        let preferences = try XCTUnwrap(state["preferences"] as? [String: Bool])
        XCTAssertEqual(preferences.count, 2)
        XCTAssertTrue(preferences.values.allSatisfy { !$0 })
        XCTAssertEqual(state["microphoneUndetermined"] as? Bool, true)
        XCTAssertEqual(state["speechUndetermined"] as? Bool, true)
    }

    private func operation(_ mode: String, token: String) async throws -> [String: Any] {
        let result = try await TestOperationBroker.shared.request("fixture-isolation", parameters: ["mode": mode, "token": token])
        XCTAssertEqual(result["platform"] as? String, "ios")
        XCTAssertEqual(result["runtime"] as? String, "Hermes")
        XCTAssertEqual(result["encrypted"] as? Bool, true)
        return result
    }

    private func attach(_ value: [String: Any], name: String) throws {
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: value), uniformTypeIdentifier: "public.json")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
