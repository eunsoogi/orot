import Foundation
@testable import Orot
import XCTest

/// Calls the shipping RAG workflow with the original public synthetic query, actual Apple generation, and real Europe PMC responses.
final class RagWorkflowIntegrationTests: OrotFailFastTestCase {
    func testPublicRetrievalReturnsAnAnswerWithGroundedCitations() async throws {
        let result = try await TestOperationBroker.shared.request("rag-workflow", timeout: 150)
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: result), uniformTypeIdentifier: "public.json")
        attachment.name = "actual-public-literature-rag-workflow"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertEqual(result["platform"] as? String, "ios")
        XCTAssertEqual(result["runtime"] as? String, "Hermes")
        // Unavailable models, network errors, deadlines and safe failures remain failed acceptance results, not skips.
        XCTAssertEqual(result["availability"] as? String, "available")
        XCTAssertEqual(result["retrieval"] as? String, "observed")
        for key in ["requests", "responses", "publications"] {
            XCTAssertFalse(try XCTUnwrap(result[key] as? [Any]).isEmpty, key)
        }
        XCTAssertEqual(result["terminal"] as? String, "answer")
        let outcome = try XCTUnwrap(result["outcome"] as? [String: Any])
        XCTAssertEqual(outcome["status"] as? String, "answer")
        XCTAssertFalse(try XCTUnwrap(outcome["citations"] as? [Any]).isEmpty)
    }
}
