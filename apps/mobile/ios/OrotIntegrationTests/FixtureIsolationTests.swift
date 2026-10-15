import Foundation
@testable import Orot
import XCTest

/// Two host-orchestrated processes prove real database cleanup and key renewal without relying on an accessibility session.
final class FixtureIsolationTests: OrotFailFastTestCase {
    func testSeedActualEncryptedDatabaseBeforeScopedReset() async throws {
        let token = try token()
        let before = try TestFixtureState.snapshot(token)
        try assertClean(before)
        let result = try await operation("seed", token: token)
        XCTAssertEqual(result["seeded"] as? Bool, true)
        let after = try TestFixtureState.snapshot(token)
        XCTAssertNotNil(after["keyFingerprint"] as? String)
        try attach(["state": after, "result": result, "processIdentifier": ProcessInfo.processInfo.processIdentifier], name: "fixture-isolation-seeded")
    }

    func testScopedResetRemovesPollutionBeforeNewDatabaseOpen() async throws {
        let token = try token()
        let text = try XCTUnwrap(ProcessInfo.processInfo.environment["OROT_FIXTURE_BASELINE"])
        let baseline = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        XCTAssertNotEqual(baseline["processIdentifier"] as? Int, Int(ProcessInfo.processInfo.processIdentifier))
        let before = try TestFixtureState.snapshot(token)
        try assertClean(before)
        XCTAssertEqual(before["foreignFile"] as? Bool, true)
        XCTAssertEqual(before["foreignKey"] as? Bool, true)
        let result = try await operation("verify", token: token)
        XCTAssertEqual(result["oldRecordAbsent"] as? Bool, true)
        let after = try TestFixtureState.snapshot(token)
        let previous = try XCTUnwrap(baseline["state"] as? [String: Any])
        let fingerprint = try XCTUnwrap(after["keyFingerprint"] as? String)
        XCTAssertNotEqual(fingerprint, previous["keyFingerprint"] as? String)
        XCTAssertEqual(after["foreignFile"] as? Bool, true)
        XCTAssertEqual(after["foreignKey"] as? Bool, true)
        try attach(["before": before, "after": after, "result": result,
                    "processIdentifier": ProcessInfo.processInfo.processIdentifier], name: "fixture-isolation-verified")
        try TestFixtureState.removeSentinels(token)
    }

    private func token() throws -> String {
        let value = try XCTUnwrap(ProcessInfo.processInfo.environment["OROT_FIXTURE_TOKEN"])
        XCTAssertNotNil(UUID(uuidString: value))
        return value
    }

    private func assertClean(_ state: [String: Any]) throws {
        let paths = try XCTUnwrap(state["paths"] as? [String: Bool])
        let keys = try XCTUnwrap(state["keys"] as? [String: Bool])
        XCTAssertEqual(paths.count, 6)
        XCTAssertEqual(keys.count, 5)
        XCTAssertTrue(paths.values.allSatisfy { !$0 })
        XCTAssertTrue(keys.values.allSatisfy { !$0 })
        // React recreates its RTL layout preference on launch; the host already proved an empty domain before React started.
        XCTAssertEqual(state["pollutedPreferencesAbsent"] as? Bool, true)
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
