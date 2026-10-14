import Foundation
@testable import Orot
import XCTest

final class HermesDomainIntegrationTests: OrotFailFastTestCase {
    func testHostExecutesHermesOperations() async throws {
        let result = try await operation("connection")
        XCTAssertEqual(result["connected"] as? Bool, true)
    }

    func testTwentyGraphInvocationsAndStreams() async throws {
        let result = try await operation("graph")
        XCTAssertEqual(result["invocations"] as? Int, 20)
        XCTAssertEqual(result["streams"] as? Int, 20)
        XCTAssertEqual(result["duplicateNodes"] as? Int, 0)
    }

    func testSourceLinkedLocalQueriesRemoveTheirSyntheticFixtures() async throws {
        let result = try await operation("local-query", parameters: ["queryIdentifier": "test-query-\(UUID().uuidString)"])
        XCTAssertEqual(result["synthetic"] as? Bool, true)
        XCTAssertEqual(result["summary"] as? String,
                       "healthQueries=5; healthRecords=6; bloodPressure=2; sleep=asleepDeep; dose=not_logged; medication=timeBasis:local_ingest; appointment=confirmed; transcript=source-linked; cipher=available; wrongKey=rejected; cleanup=true")
    }

    func testEncryptedSourceEvidenceAndRagRelationships() async throws {
        let parameters = ["storageIdentifier": "test-storage-\(UUID().uuidString)"]
        let created = try await operation("storage-create", parameters: parameters)
        XCTAssertEqual(created["encrypted"] as? Bool, true)
        XCTAssertEqual(created["wrongKeyRejected"] as? Bool, true)
        let restored = try await operation("storage-read", parameters: parameters)
        XCTAssertEqual(restored["sourceAndEvidenceRestored"] as? Bool, true)
        XCTAssertEqual(restored["ragChunksVerified"] as? Bool, true)
    }

    func testMemoryDeletionKeepsTombstonesAndRemovesSearchEvidence() async throws {
        let parameters = ["fixtureIdentifier": "test-memory-\(UUID().uuidString)"]
        _ = try await operation("memory-create", parameters: parameters)
        let deleted = try await operation("memory-delete", parameters: parameters)
        XCTAssertEqual(deleted["removed"] as? Bool, true)
        let tombstone = try await operation("memory-tombstone", parameters: parameters)
        XCTAssertEqual(tombstone["tombstoneVerified"] as? Bool, true)
        let absent = try await operation("memory-verify-deletion", parameters: parameters)
        XCTAssertEqual(absent["absentFromMemoryAndSearch"] as? Bool, true)
    }

    private func operation(_ name: String, parameters: [String: Any] = [:]) async throws -> [String: Any] {
        let result = try await TestOperationBroker.shared.request(name, parameters: parameters)
        XCTAssertEqual(result["platform"] as? String, "ios")
        XCTAssertEqual(result["runtime"] as? String, "Hermes")
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: result), uniformTypeIdentifier: "public.json")
        attachment.name = "hermes-domain-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
        return result
    }
}
