import Foundation
@testable import Orot
import XCTest

final class AppleModelIntegrationTests: OrotFailFastTestCase {
    func testMockAvailabilityGenerationStreamingCancellationAndFailures() async throws {
        // The shipping bridge runs against a test-only raw-response mock; this does not measure Apple inference.
        let result = try await TestOperationBroker.shared.request("apple-model")
        XCTAssertEqual(result["platform"] as? String, "ios")
        XCTAssertEqual(result["runtime"] as? String, "Hermes")
        XCTAssertEqual(result["inferenceStop"] as? String, "unverified")
        let availability = try XCTUnwrap(result["availability"] as? String)
        // The scripted available case must execute all original app-side generation and cancellation assertions.
        XCTAssertEqual(availability, "available", "The configured mock must reach the native bridge")
        // Keep the fixture aligned with the native bridge's generic unknown-reason fallback.
        XCTAssertTrue(["available", "disabled", "modelNotReady", "unavailable", "unsupportedDevice", "unsupportedLanguage"].contains(availability))
        if availability == "available" {
            XCTAssertEqual(result["generation"] as? String, "passed")
            XCTAssertEqual(result["sourceIdPreserved"] as? String, "passed")
            XCTAssertGreaterThan(result["streamedUpdates"] as? Int ?? 0, 0)
            let question = try XCTUnwrap(result["questionText"] as? String)
            XCTAssertFalse(question.isEmpty)
            XCTAssertNotEqual(question, "not-run")
            XCTAssertTrue(try ["cancelled", "completed-before-cancel"].contains(XCTUnwrap(result["cancellation"] as? String)))
        } else {
            for field in ["generation", "sourceIdPreserved", "questionText", "streamedUpdates", "cancellation"] {
                XCTAssertEqual(result[field] as? String, "not-run", field)
            }
        }
        XCTAssertEqual(result["modelExecution"] as? String, "mock")
        XCTAssertEqual(result["actualModel"] as? String, "not-run")
        XCTAssertEqual(result["cancellation"] as? String, "cancelled")
        let bridge = try XCTUnwrap(result["bridge"] as? [String: Any])
        XCTAssertEqual(bridge["modelExecution"] as? String, "mock")
        XCTAssertEqual((bridge["streamed"] as? [Any])?.count, 3)
        XCTAssertEqual((bridge["cancelled"] as? [Any])?.count, 2)
        XCTAssertEqual((bridge["rewritten"] as? [Any])?.count, 3)
        let guided = try XCTUnwrap(bridge["guided"] as? [String: Any])
        let guidedPackets = try XCTUnwrap(guided["packets"] as? [[String: Any]])
        XCTAssertEqual(guidedPackets.count, 3)
        let guidedCompletion = try XCTUnwrap(guidedPackets.last?["response"] as? [String: Any])
        let structuredOutput = try XCTUnwrap(guidedCompletion["structuredOutput"] as? [String: Any])
        XCTAssertEqual(structuredOutput["sourceId"] as? String, "synthetic-source-42")
        let guidedRequests = try XCTUnwrap(guided["requests"] as? [[String: Any]])
        let guidedRequest = try XCTUnwrap(guidedRequests.first)
        XCTAssertEqual(guidedRequest["streaming"] as? Bool, true)
        let nativeRequest = try XCTUnwrap(guidedRequest["request"] as? [String: Any])
        XCTAssertEqual(nativeRequest["mode"] as? String, "structured")
        XCTAssertNotNil(nativeRequest["schema"])
        XCTAssertEqual(bridge["failed"] as? String, "GENERATION_FAILED")
        XCTAssertEqual(bridge["invalid"] as? String, "GENERATION_FAILED")
        XCTAssertEqual(bridge["unavailable"] as? [String], ["disabled", "modelNotReady", "unsupportedDevice", "unsupportedLanguage"])
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: result), uniformTypeIdentifier: "public.json")
        attachment.name = "apple-model-mock-bridge-results"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
