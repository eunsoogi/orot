import Foundation
@testable import Orot
import XCTest

/// Three host invocations retain one real database and prove new process identities without accessibility sessions.
final class StatePersistenceIntegrationTests: OrotFailFastTestCase {
    func testFreshEncryptedStorageMemoryAndCheckpoint() async throws {
        let fixture = try fixtureIdentifier()
        let storage = try await operation("storage-create", parameters: ["storageIdentifier": fixture.replacingOccurrences(of: "test-persistence-", with: "test-storage-")])
        truths(storage, ["encrypted", "wrongKeyRejected", "recordsVerified"])
        let memory = try await operation("memory-create", parameters: ["fixtureIdentifier": memoryIdentifier()])
        truths(memory, ["persisted", "networkDisabled"])
        let checkpoint = try await operation("checkpoint-persistence", parameters: ["fixtureIdentifier": fixture, "mode": "save"])
        XCTAssertEqual(checkpoint["value"] as? Int, 4)
        XCTAssertEqual(checkpoint["nodeRuns"] as? [String], ["increment"])
        XCTAssertEqual(checkpoint["note"] as? String, "환자 기록: café 🌱🩺")
        try attach(fixture, phase: "seed")
    }

    func testStorageReadMemoryDeletionAndCheckpointResumeInNewProcess() async throws {
        let fixture = try fixtureIdentifier()
        try requireNewProcess()
        let storage = try await operation("storage-read", parameters: ["storageIdentifier": fixture.replacingOccurrences(of: "test-persistence-", with: "test-storage-")])
        truths(storage, ["sourceAndEvidenceRestored", "ragChunksVerified"])
        let memory = try await operation("memory-restart", parameters: ["fixtureIdentifier": memoryIdentifier()])
        truths(memory, ["restoredBeforeDeletion", "removed", "networkDisabled"])
        let checkpoint = try await operation("checkpoint-persistence", parameters: ["fixtureIdentifier": fixture, "mode": "resume"])
        XCTAssertEqual(checkpoint["value"] as? Int, 8)
        XCTAssertEqual(checkpoint["nodeRuns"] as? [String], ["increment", "double"])
        XCTAssertEqual(checkpoint["note"] as? String, "환자 기록: café 🌱🩺")
        XCTAssertEqual(checkpoint["cleaned"] as? Bool, true)
        try attach(fixture, phase: "resume")
    }

    func testRemovedMemoryAndSearchStayAbsentInThirdProcess() async throws {
        let fixture = try fixtureIdentifier()
        try requireNewProcess()
        let result = try await operation("memory-verify-deletion", parameters: ["fixtureIdentifier": memoryIdentifier()])
        truths(result, ["absentFromMemoryAndSearch", "networkDisabled"])
        try attach(fixture, phase: "absence")
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

    private func attach(_ fixture: String, phase: String) throws {
        let receipt: [String: Any] = try ["fixtureIdentifier": fixture, "memoryIdentifier": memoryIdentifier(), "phase": phase,
                                          "processIdentifier": ProcessInfo.processInfo.processIdentifier]
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: receipt), uniformTypeIdentifier: "public.json")
        attachment.name = "state-persistence-\(phase)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
