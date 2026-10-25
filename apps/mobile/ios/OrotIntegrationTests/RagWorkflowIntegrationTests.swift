import Foundation
@testable import Orot
import XCTest

/// Keeps the shipping RAG workflow and provider mapping; only model and HTTP responses are synthetic.
final class RagWorkflowIntegrationTests: OrotFailFastTestCase {
    func testPublicRetrievalReturnsAnAnswerWithGroundedCitations() async throws {
        let result = try await TestOperationBroker.shared.request("rag-workflow")
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: result), uniformTypeIdentifier: "public.json")
        attachment.name = "mock-model-mock-literature-rag-workflow"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertEqual(result["platform"] as? String, "ios")
        XCTAssertEqual(result["runtime"] as? String, "Hermes")
        // Mock success proves application wiring, never live provider availability or model quality.
        XCTAssertEqual(result["modelExecution"] as? String, "mock")
        XCTAssertEqual(result["literatureExecution"] as? String, "mock")
        XCTAssertEqual(result["actualModel"] as? String, "not-run")
        XCTAssertEqual(result["availability"] as? String, "available")
        XCTAssertEqual(result["retrieval"] as? String, "observed")
        let consent = try XCTUnwrap(result["consent"] as? [[String: String]])
        XCTAssertEqual(consent, [["query": "(sleep duration adults) AND HAS_ABSTRACT:y", "decision": "authorized"]])
        for key in ["requests", "responses", "publications"] {
            XCTAssertFalse(try XCTUnwrap(result[key] as? [Any]).isEmpty, key)
        }
        let requests = try XCTUnwrap(result["requests"] as? [String])
        XCTAssertEqual(requests.count, 1)
        let request = try XCTUnwrap(URLComponents(string: XCTUnwrap(requests.first)))
        XCTAssertEqual(request.scheme, "https")
        XCTAssertEqual(request.host, "www.ebi.ac.uk")
        XCTAssertEqual(request.path, "/europepmc/webservices/rest/search")
        let query = try XCTUnwrap(request.queryItems)
        XCTAssertEqual(query.count, 4)
        // URLSearchParams uses form encoding for spaces; Foundation queryItems preserves its plus signs.
        XCTAssertEqual(query.first { $0.name == "query" }?.value?.replacingOccurrences(of: "+", with: " "), "(sleep duration adults) AND HAS_ABSTRACT:y")
        let publications = try XCTUnwrap(result["publications"] as? [[String: Any]])
        XCTAssertEqual(publications.count, 5)
        let publication = try XCTUnwrap(publications.first)
        XCTAssertEqual(publication["recordId"] as? String, "100")
        XCTAssertEqual(publication["authors"] as? String, "Synthetic Author 0")
        XCTAssertEqual(publication["journal"] as? String, "Synthetic Journal")
        XCTAssertEqual(publication["publicationDate"] as? String, "2025-01-01")
        XCTAssertEqual(publication["updatedDate"] as? String, "2025-02-01")
        XCTAssertEqual(publication["retrievedAt"] as? String, "2026-10-07T03:00:00.000Z")
        XCTAssertEqual(publication["originalUrl"] as? String, "https://europepmc.org/article/MED/100")
        XCTAssertEqual(result["terminal"] as? String, "answer")
        let outcome = try XCTUnwrap(result["outcome"] as? [String: Any])
        XCTAssertEqual(outcome["status"] as? String, "answer")
        let citations = try XCTUnwrap(outcome["citations"] as? [[String: Any]])
        XCTAssertEqual(citations.first?["evidenceId"] as? String, "MED:100")
    }
}
