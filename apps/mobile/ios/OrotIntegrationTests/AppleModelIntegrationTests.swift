import Foundation
@testable import Orot
import XCTest
#if canImport(FoundationModels)
    import FoundationModels
#endif

final class AppleModelIntegrationTests: OrotFailFastTestCase {
    func testStreamingFailurePreservesKnownNativeDecisions() {
        // These bridge-level synthetic errors do not claim real Apple model execution.
        for code in ["SAFETY_REFUSAL", "UNSUPPORTED_CAPABILITY", "INVALID_REQUEST"] {
            let packet = appleFoundationModelsErrorPacket(appleFoundationModelsFailure(code, "Synthetic failure", nil))
            XCTAssertEqual(packet["type"] as? String, "error")
            XCTAssertEqual(packet["code"] as? String, code)
        }
        let unavailable = appleFoundationModelsErrorPacket(
            appleFoundationModelsFailure("APPLE_MODEL_UNAVAILABLE", "Synthetic unavailable", "modelNotReady"),
        )
        XCTAssertEqual(unavailable["status"] as? String, "modelNotReady")
    }

    func testMockAvailabilityGenerationStreamingCancellationAndFailures() async throws {
        // Closed diagnostics distinguish SDK decoding from bridge failures without exposing messages.
        XCTAssertEqual(appleFoundationModelsFailureCategory(NSError(domain: "FoundationModels.GeneratedContent.ParsingError", code: 1)), "decoding")
        XCTAssertEqual(appleFoundationModelsFailureCategory(NSError(domain: "FoundationModels.LanguageModelSession.Error", code: 0)), "concurrent_requests")
        XCTAssertEqual(appleFoundationModelsFailureCategory(NSError(domain: "FoundationModels.LanguageModelSession.Error", code: 1)), "transcript_mutation")
        XCTAssertEqual(appleFoundationModelsFailureCategory(AppleNativeToolGeneration.failure("Synthetic", category: .requiredToolMissing)), "required_tool_missing")
        XCTAssertEqual(appleFoundationModelsFailureCategory(AppleNativeToolGeneration.failure("Synthetic", category: .callbackConflict)), "callback_conflict")
        XCTAssertEqual(appleFoundationModelsFailureCategory(NSError(domain: "AppleFoundationModels", code: 1, userInfo: ["diagnosticCategory": "untrusted value"])), "bridge_failure")
        #if canImport(FoundationModels)
            if #available(iOS 27.0, *) {
                // Inspect real SDK options without running inference or selecting a tool for the model.
                let required = AppleFoundationModelsCodec.nativeToolOptions([
                    "nativeToolChoice": "required", "temperature": 0.2, "maxOutputTokens": 512,
                ])
                XCTAssertEqual(required.toolCallingMode, .required)
                XCTAssertEqual(required.temperature, 0.2)
                XCTAssertEqual(required.maximumResponseTokens, 512)
                XCTAssertEqual(AppleFoundationModelsCodec.nativeToolOptions(["nativeToolChoice": "required"], hasInvokedTool: true).toolCallingMode, .disallowed)
                XCTAssertEqual(AppleFoundationModelsCodec.nativeToolOptions(["nativeToolChoice": "auto"], hasInvokedTool: true).toolCallingMode, .disallowed)
                XCTAssertEqual(AppleFoundationModelsCodec.nativeToolOptions(["nativeToolChoice": "auto"]).toolCallingMode, .allowed)
            }
        #endif
        // The shipping bridge runs against a test-only raw-response mock; this does not measure Apple inference.
        let result = try await TestOperationBroker.shared.request("apple-model")
        XCTAssertEqual(result["platform"] as? String, "ios")
        XCTAssertEqual(result["runtime"] as? String, "Hermes")
        XCTAssertEqual(result["inferenceStop"] as? String, "unverified")
        let availability = try XCTUnwrap(result["availability"] as? String)
        // The scripted available case must execute all original app-side generation and cancellation assertions.
        XCTAssertEqual(availability, "available", "The configured mock must reach the native bridge")
        XCTAssertTrue(["available", "disabled", "modelNotReady", "unsupportedDevice", "unsupportedLanguage"].contains(availability))
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
