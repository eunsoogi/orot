import Foundation
@testable import Orot
import XCTest

/// Three host invocations retain one real database and prove new process identities without accessibility sessions.
final class StatePersistenceIntegrationTests: OrotFailFastTestCase {
    func testFreshEncryptedStorageMemoryAndCheckpoint() async throws {
        let fixture = try fixtureIdentifier()
        let storage = try await operation("storage-create", parameters: ["storageIdentifier": fixture.replacingOccurrences(of: "test-persistence-", with: "test-storage-")])
        truths(storage, ["encrypted", "wrongKeyRejected", "recordsVerified"])
        let memory = try await storeOperation("memory-create", phase: "fresh")
        let checkpoint = try await operation("checkpoint-persistence", parameters: ["fixtureIdentifier": fixture, "mode": "save"])
        XCTAssertEqual(checkpoint["value"] as? Int, 4)
        XCTAssertEqual(checkpoint["nodeRuns"] as? [String], ["increment"])
        XCTAssertEqual(checkpoint["note"] as? String, "환자 기록: café 🌱🩺")
        try attach(fixture, phase: "seed", storeReceipt: memory)
    }

    func testStorageReadMemoryDeletionAndCheckpointResumeInNewProcess() async throws {
        let fixture = try fixtureIdentifier()
        try requireNewProcess()
        let storage = try await operation("storage-read", parameters: ["storageIdentifier": fixture.replacingOccurrences(of: "test-persistence-", with: "test-storage-")])
        truths(storage, ["sourceAndEvidenceRestored", "ragChunksVerified"])
        let memory = try await storeOperation("memory-restart", phase: "restart")
        let checkpoint = try await operation("checkpoint-persistence", parameters: ["fixtureIdentifier": fixture, "mode": "resume"])
        XCTAssertEqual(checkpoint["value"] as? Int, 8)
        XCTAssertEqual(checkpoint["nodeRuns"] as? [String], ["increment", "double"])
        XCTAssertEqual(checkpoint["note"] as? String, "환자 기록: café 🌱🩺")
        XCTAssertEqual(checkpoint["cleaned"] as? Bool, true)
        try attach(fixture, phase: "resume", storeReceipt: memory)
    }

    func testRemovedMemoryAndSearchStayAbsentInThirdProcess() async throws {
        let fixture = try fixtureIdentifier()
        try requireNewProcess()
        let memory = try await storeOperation("memory-verify-deletion", phase: "verify-deletion")
        try attach(fixture, phase: "absence", storeReceipt: memory)
    }

    /// Every phase returns observed Store identifiers, timestamps and provenance, rather than driver success constants.
    private func storeOperation(_ name: String, phase: String) async throws -> [String: Any] {
        let identifier = try memoryIdentifier()
        let result = try await operation(name, parameters: ["fixtureIdentifier": identifier, "storePersistence": true])
        XCTAssertEqual(result["synthetic"] as? Bool, true)
        let receipt = try XCTUnwrap(result["storeReceipt"] as? [String: Any])
        XCTAssertEqual(receipt["fixtureIdentifier"] as? String, identifier)
        XCTAssertEqual(receipt["phase"] as? String, phase)
        truths(receipt, ["sqlCipher", "storeVerified", "syntheticProvider"])
        XCTAssertEqual(receipt["networkAttempts"] as? Int, 0)
        XCTAssertGreaterThan(try XCTUnwrap(receipt["graphSearches"] as? Int), 0)
        XCTAssertFalse(try XCTUnwrap(receipt["memoryId"] as? String).isEmpty)
        XCTAssertEqual(receipt["memoryKey"] as? String, "preference:\(identifier):outpatient-reminder")
        for field in ["createdAt", "updatedAt", "memoryCreatedAt"] {
            XCTAssertGreaterThan(try XCTUnwrap(receipt[field] as? Double), 0, field)
        }
        let provenance = try XCTUnwrap(receipt["provenance"] as? [String: Any])
        XCTAssertEqual(provenance["sourceIds"] as? [String], [identifier])
        XCTAssertEqual(provenance["reviewState"] as? String, "user_confirmed")
        let dates = try XCTUnwrap(provenance["sourceDates"] as? [[String: String]])
        XCTAssertEqual(dates, [["sourceId": identifier, "date": "2026-01-02T00:00:00Z"]])
        return receipt
    }

    private func fixtureIdentifier() throws -> String {
        let fixture = try XCTUnwrap(ProcessInfo.processInfo.environment["OROT_STATE_FIXTURE"])
        XCTAssertTrue(fixture.hasPrefix("test-persistence-"))
        XCTAssertNotNil(UUID(uuidString: String(fixture.dropFirst("test-persistence-".count))))
        return fixture
    }

    private func requireNewProcess() throws {
        let text = try XCTUnwrap(ProcessInfo.processInfo.environment["OROT_STATE_PREVIOUS_PIDS"])
        let previous = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [Int])
        XCTAssertFalse(previous.isEmpty)
        XCTAssertFalse(previous.contains(Int(ProcessInfo.processInfo.processIdentifier)))
    }

    private func memoryIdentifier() throws -> String {
        // Storage and memory probes hash UUID bytes; separate UUIDs prevent accidental source deduplication across domains.
        let identifier = try XCTUnwrap(ProcessInfo.processInfo.environment["OROT_STATE_MEMORY_FIXTURE"])
        XCTAssertTrue(identifier.hasPrefix("test-memory-"))
        let uuid = try XCTUnwrap(UUID(uuidString: String(identifier.dropFirst("test-memory-".count))))
        XCTAssertNotEqual(uuid, try UUID(uuidString: String(fixtureIdentifier().dropFirst("test-persistence-".count))))
        return identifier
    }

    private func operation(_ name: String, parameters: [String: Any]) async throws -> [String: Any] {
        // Preserve the operation and assertions while awaiting the real response, independent of host speed.
        let result = try await TestOperationBroker.shared.request(name, parameters: parameters)
        XCTAssertEqual(result["platform"] as? String, "ios")
        XCTAssertEqual(result["runtime"] as? String, "Hermes")
        return result
    }

    private func truths(_ result: [String: Any], _ fields: [String]) {
        for field in fields {
            XCTAssertEqual(result[field] as? Bool, true, field)
        }
    }

    private func attach(_ fixture: String, phase: String, storeReceipt: [String: Any]) throws {
        let receipt: [String: Any] = try ["fixtureIdentifier": fixture, "memoryIdentifier": memoryIdentifier(), "phase": phase,
                                          "processIdentifier": ProcessInfo.processInfo.processIdentifier, "storeReceipt": storeReceipt]
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: receipt), uniformTypeIdentifier: "public.json")
        attachment.name = "state-persistence-\(phase)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
