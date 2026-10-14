import Foundation
@testable import Orot
import XCTest

/// The host runner isolates corpora and starts a different process for each persistence read; these call the real ORT, SQLCipher and FTS probes.
final class LocalModelIntegrationTests: OrotFailFastTestCase {
    func testFreshE5RetrievalMeasurementsAndNativeCancellation() async throws {
        let result = try await run("local-e5", parameters: ["mode": "fresh"], timeout: 900)
        try e5(result, mode: "fresh")
        XCTAssertGreaterThan(try number(result, "progressEvents"), 0)
        XCTAssertEqual(result["cancellation"] as? String, "cancelled")
        let response = try number(result, "cancellationResponseMilliseconds")
        let settlement = try number(result, "cancellationSettlementMilliseconds")
        XCTAssertGreaterThanOrEqual(response, 0)
        XCTAssertGreaterThanOrEqual(settlement, response)
    }

    func testE5IndexAndKoreanRetrievalSurviveProcessRestart() async throws {
        let result = try await run("local-e5", parameters: ["mode": "restart"], timeout: 300)
        try e5(result, mode: "restart")
    }

    func testFreshHybridSearchPreservesFiltersLocatorsAndTemporaryTableCleanup() async throws {
        try await hybrid(run("hybrid-retrieval", timeout: 900), mode: "indexed")
    }

    func testHybridRetainedVectorSurvivesProcessRestartWithoutReindexing() async throws {
        try await hybrid(run("hybrid-retrieval", timeout: 900), mode: "reopened")
    }

    private func run(_ operation: String, parameters: [String: Any] = [:], timeout: TimeInterval) async throws -> [String: Any] {
        let envelope = try await TestOperationBroker.shared.request(operation, parameters: parameters, timeout: timeout)
        XCTAssertEqual(envelope["platform"] as? String, "ios")
        XCTAssertEqual(envelope["runtime"] as? String, "Hermes")
        XCTAssertEqual(envelope["syntheticCorpus"] as? Bool, true)
        let result = try XCTUnwrap(envelope["result"] as? [String: Any])
        let receipt: [String: Any] = ["hostProcessIdentifier": ProcessInfo.processInfo.processIdentifier, "result": result]
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: receipt), uniformTypeIdentifier: "public.json")
        attachment.name = "local-model-observed-result"
        attachment.lifetime = .keepAlways
        add(attachment)
        return result
    }

    private func e5(_ result: [String: Any], mode: String) throws {
        XCTAssertEqual(result["mode"] as? String, mode)
        XCTAssertEqual(result["modelIdentityMatches"] as? Bool, true)
        XCTAssertEqual(try number(result, "persistedVectorCount"), 6)
        XCTAssertGreaterThanOrEqual(try number(result, "top1"), 4)
        XCTAssertEqual(try number(result, "recallAt3"), 5)
        XCTAssertGreaterThanOrEqual(try number(result, "meanReciprocalRank"), 0.8)
        XCTAssertEqual(result["progressMonotonic"] as? Bool, true)
        XCTAssertEqual(try XCTUnwrap(result["retrievalMilliseconds"] as? [NSNumber]).count, 5)
        let runtime = try XCTUnwrap(result["runtime"] as? [String: Any])
        XCTAssertEqual(runtime["modelLoaded"] as? Bool, true)
        for key in ["downloadMilliseconds", "sessionLoadMilliseconds", "footprintAfterLoadBytes", "inferenceMilliseconds", "inferencePeakFootprintBytes"] {
            XCTAssertGreaterThanOrEqual(try number(runtime, key), 0, key)
        }
    }

    private func hybrid(_ result: [String: Any], mode: String) throws {
        XCTAssertEqual(result["mode"] as? String, mode)
        XCTAssertEqual(result["sqlCipherEnabled"] as? Bool, true)
        XCTAssertEqual(try number(result, "tempStoreMode"), 2)
        XCTAssertEqual(try number(result, "remainingVectorCount"), 1)
        let fts = try XCTUnwrap(result["ftsOnly"] as? [String: Any])
        XCTAssertEqual(try number(fts, "lexicalRank"), 1)
        XCTAssertTrue(fts["vectorRank"] is NSNull)
        let vector = try XCTUnwrap(result["vectorOnly"] as? [String: Any])
        XCTAssertTrue(vector["lexicalRank"] is NSNull)
        XCTAssertEqual(try number(vector, "vectorRank"), 1)
        for key in ["filtersApplied", "locatorPreserved", "temporaryTablesCleaned"] {
            XCTAssertEqual(result[key] as? Bool, true, key)
        }
    }

    private func number(_ result: [String: Any], _ key: String) throws -> Double {
        let value = try XCTUnwrap(result[key] as? NSNumber, key).doubleValue
        XCTAssertTrue(value.isFinite, key)
        return value
    }
}
